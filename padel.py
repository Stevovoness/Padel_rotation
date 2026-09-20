#!/usr/bin/env python3
"""
Padel rotation scheduler -> phone-friendly PDF.

Any number of courts, any number of players (at least 4 per court). Everyone
gets equal court time where the numbers allow, nobody plays a long block and
then disappears, and the result is a narrow phone-shaped PDF that reads well
when it lands in a WhatsApp group.

    py padel.py
    py padel.py --start 8:00 --open
    py padel.py --courts 2 --players "Ann,Ben,..." --location "Virgin Active"
    py padel.py --players-file names.txt --minutes 120

There is also a GUI: py padel_gui.py

Requires: reportlab  (py -m pip install reportlab)
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from io import BytesIO

from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas as pdfcanvas

COURT_SIZE = 4  # players on one padel court
MAX_PLAYERS = 32
MAX_COURTS = 8
MAX_RUN = 2  # aim: never more than this many rounds on (or off) in a row

# Edit this list, or pass --players / --players-file on the command line.
DEFAULT_PLAYERS = ["Reuben", "John", "Robyn", "Stephen", "Marco", "Tiaan", "Simone"]


def min_players(courts: int) -> int:
    return COURT_SIZE * courts


# --------------------------------------------------------------------------
# model
# --------------------------------------------------------------------------


@dataclass
class Session:
    players: list[str]
    minutes: int
    n_rounds: int
    courts: int = 1
    start: datetime | None = None
    title: str = "Padel Rotation"
    date_text: str = ""
    location: str = ""

    @property
    def n_players(self) -> int:
        return len(self.players)

    @property
    def slots(self) -> int:
        """How many players are on court in any one round."""
        return COURT_SIZE * self.courts

    @property
    def round_minutes(self) -> float:
        return self.minutes / self.n_rounds


@dataclass(frozen=True)
class Match:
    court: int  # 1-based, as printed on the PDF
    team_a: tuple[int, ...]
    team_b: tuple[int, ...]

    @property
    def players(self) -> tuple[int, ...]:
        return self.team_a + self.team_b


@dataclass
class Round:
    number: int
    matches: tuple[Match, ...]
    resting: tuple[int, ...]
    start_min: int
    end_min: int

    @property
    def playing(self) -> tuple[int, ...]:
        return tuple(p for m in self.matches for p in m.players)

    def court_of(self, player: int) -> int | None:
        for m in self.matches:
            if player in m.players:
                return m.court
        return None

    def side_of(self, player: int) -> str | None:
        """'a' or 'b' - which half of the court, used for the glance grid."""
        for m in self.matches:
            if player in m.team_a:
                return "a"
            if player in m.team_b:
                return "b"
        return None


@dataclass
class Stats:
    games: dict[int, int] = field(default_factory=dict)
    rounds_played: dict[int, list[int]] = field(default_factory=dict)
    max_streak: int = 0
    max_rest_streak: int = 0
    partners: dict[tuple[int, int], int] = field(default_factory=dict)
    distinct_partners: dict[int, int] = field(default_factory=dict)


# --------------------------------------------------------------------------
# scheduling: how many rounds
# --------------------------------------------------------------------------

BAND_LOW, BAND_HIGH = 12.0, 18.0  # a round length that feels right
HARD_LOW, HARD_HIGH = 6.0, 25.0  # anything outside this is silly


def choose_rounds(minutes: int, n_players: int, courts: int = 1, target_len: float = 15.0) -> int:
    """Pick a round count.

    First preference is a count where everyone plays exactly the same number of
    rounds *and* the rounds land in a comfortable 12-18 minute band. Failing
    that, round length wins and one player may get a game more than another.
    """
    slots = COURT_SIZE * courts
    best_round, best_score = None, None
    for r in range(1, 41):
        length = minutes / r
        if not HARD_LOW <= length <= HARD_HIGH:
            continue
        fair = (r * slots) % n_players == 0
        in_band = BAND_LOW <= length <= BAND_HIGH
        whole = abs(length - round(length)) < 1e-9
        score = (
            0 if (fair and in_band) else 1,
            abs(length - target_len),
            0 if whole else 1,
            0 if fair else 1,
        )
        if best_score is None or score < best_score:
            best_round, best_score = r, score
    return best_round or max(1, round(minutes / target_len))


# --------------------------------------------------------------------------
# scheduling: who is on court
# --------------------------------------------------------------------------


def quotas(n_players: int, n_rounds: int, slots: int, rng: random.Random) -> list[int]:
    """Games per player: as equal as the numbers allow."""
    total = n_rounds * slots
    base, extra = divmod(total, n_players)
    q = [base] * n_players
    for p in rng.sample(range(n_players), extra):
        q[p] += 1
    return q


def _greedy_attendance(n_players, n_rounds, slots, quota, rng) -> list[set[int]]:
    """Fill each round with whoever is furthest behind on court time."""
    remaining = list(quota)
    rounds: list[set[int]] = []
    for _ in range(n_rounds):
        order = sorted(range(n_players), key=lambda p: (-remaining[p], rng.random()))
        picked = order[:slots]
        for p in picked:
            remaining[p] -= 1
        rounds.append(set(picked))
    return rounds


def player_cost(seq: list[int]) -> float:
    """One player's rotation: long on/off runs cost a lot, bunching a little."""
    n_rounds = len(seq)
    cost = 0.0

    i = 0
    while i < n_rounds:
        j = i
        while j + 1 < n_rounds and seq[j + 1] == seq[i]:
            j += 1
        run = j - i + 1
        if run > MAX_RUN:
            cost += 60.0 * (run - MAX_RUN) ** 2
        i = j + 1

    played = [r for r in range(n_rounds) if seq[r]]
    if played:
        step = n_rounds / len(played)
        for k, r in enumerate(played):
            ideal = (k + 0.5) * step - 0.5  # evenly spread across the session
            cost += (r - ideal) ** 2
    return cost


def anneal_attendance(att, n_players, n_rounds, rng, iters=4000, patience=700):
    """Swap a player between two rounds; quotas and round sizes stay intact.

    A swap only touches two players, so only their two costs are recomputed.
    """
    cur = [set(s) for s in att]
    seqs = [[1 if p in cur[r] else 0 for r in range(n_rounds)] for p in range(n_players)]
    costs = [player_cost(seq) for seq in seqs]
    total = sum(costs)
    best, best_cost = [set(s) for s in cur], total
    if n_rounds < 2:
        return best, best_cost

    hot, cold = 2.5, 0.02
    stale = 0
    for step in range(iters):
        temp = hot * (cold / hot) ** (step / max(1, iters - 1))
        r1, r2 = rng.sample(range(n_rounds), 2)
        outs = list(cur[r1] - cur[r2])
        ins = list(cur[r2] - cur[r1])
        if not outs or not ins:
            continue
        p, q = rng.choice(outs), rng.choice(ins)

        seqs[p][r1], seqs[p][r2] = 0, 1
        seqs[q][r1], seqs[q][r2] = 1, 0
        new_p, new_q = player_cost(seqs[p]), player_cost(seqs[q])
        delta = (new_p + new_q) - (costs[p] + costs[q])

        if delta <= 0 or rng.random() < math.exp(-delta / temp):
            costs[p], costs[q] = new_p, new_q
            total += delta
            cur[r1].discard(p), cur[r1].add(q)
            cur[r2].discard(q), cur[r2].add(p)
            if total < best_cost - 1e-9:
                best, best_cost = [set(s) for s in cur], total
                stale = 0
                continue
        else:
            seqs[p][r1], seqs[p][r2] = 1, 0
            seqs[q][r1], seqs[q][r2] = 0, 1

        stale += 1
        if stale > patience and temp < 0.3:
            break
    return best, best_cost


# --------------------------------------------------------------------------
# scheduling: which four share a court, and how they pair up
# --------------------------------------------------------------------------

SPLITS = ((0, 1, 2, 3), (0, 2, 1, 3), (0, 3, 1, 2))

OPPONENT_W = 0.3
# Court balance pulls its weight: at 1.0 nobody gets parked on court 1 all
# morning, and measured against 0.2 it costs at most one repeated partnership.
COURT_W = 1.0


def _teams(four, choice: int):
    i, j, k, l = SPLITS[choice]
    return (four[i], four[j]), (four[k], four[l])


def _key(pair) -> tuple[int, int]:
    x, y = pair
    return (x, y) if x < y else (y, x)


class _Arrangement:
    """Seats players on courts and pairs them up, scoring repeat encounters.

    Seats for round r are a flat list: [0:4] is court 1, [4:8] court 2, and so
    on. Cost is the sum of squared meeting counts, so the search naturally
    spreads partners, opponents and court usage around instead of letting the
    same four people orbit each other all morning.
    """

    def __init__(self, lineups, courts, rng):
        self.courts = courts
        self.n_rounds = len(lineups)
        self.seats = []
        for lineup in lineups:
            seats = list(lineup)
            rng.shuffle(seats)
            self.seats.append(seats)
        self.splits = [[rng.randrange(len(SPLITS)) for _ in range(courts)] for _ in lineups]

        self.partner: dict[tuple[int, int], int] = defaultdict(int)
        self.opponent: dict[tuple[int, int], int] = defaultdict(int)
        self.court_use: dict[tuple[int, int], int] = defaultdict(int)
        self.cost = 0.0
        for r in range(self.n_rounds):
            for ci in range(courts):
                self.cost += self._contribute(r, ci, +1)

    # -- scoring ----------------------------------------------------------

    @staticmethod
    def _bump(counts, key, weight, sign) -> float:
        """Add or remove one meeting, returning the change in count-squared."""
        if sign > 0:
            delta = weight * (2 * counts[key] + 1)
            counts[key] += 1
        else:
            counts[key] -= 1
            delta = -weight * (2 * counts[key] + 1)
        return delta

    def teams(self, r: int, ci: int):
        four = self.seats[r][ci * COURT_SIZE : (ci + 1) * COURT_SIZE]
        return _teams(four, self.splits[r][ci])

    def _contribute(self, r: int, ci: int, sign: int, with_court: bool = True) -> float:
        a, b = self.teams(r, ci)
        delta = 0.0
        delta += self._bump(self.partner, _key(a), 1.0, sign)
        delta += self._bump(self.partner, _key(b), 1.0, sign)
        for x in a:
            for y in b:
                delta += self._bump(self.opponent, _key((x, y)), OPPONENT_W, sign)
        if with_court and self.courts > 1:
            for p in a + b:
                delta += self._bump(self.court_use, (p, ci), COURT_W, sign)
        return delta

    # -- moves ------------------------------------------------------------

    def repair(self, r: int, ci: int, choice: int) -> float:
        """Try one of the three ways to split a foursome into two teams."""
        delta = self._contribute(r, ci, -1, with_court=False)
        self.splits[r][ci] = choice
        delta += self._contribute(r, ci, +1, with_court=False)
        self.cost += delta
        return delta

    def swap(self, r: int, s1: int, s2: int) -> float:
        """Move two players between courts in the same round."""
        c1, c2 = s1 // COURT_SIZE, s2 // COURT_SIZE
        delta = self._contribute(r, c1, -1) + self._contribute(r, c2, -1)
        self.seats[r][s1], self.seats[r][s2] = self.seats[r][s2], self.seats[r][s1]
        delta += self._contribute(r, c1, +1) + self._contribute(r, c2, +1)
        self.cost += delta
        return delta

    def snapshot(self):
        return [list(s) for s in self.seats], [list(s) for s in self.splits]


def assign_courts(lineups, courts, rng, restarts=5):
    """Anneal over court seating and team pairings together."""
    n_rounds = len(lineups)
    seats_per_round = COURT_SIZE * courts
    iters = min(9000, max(1500, 600 * n_rounds * courts))

    best_state, best_cost = None, math.inf
    for _ in range(restarts):
        arr = _Arrangement(lineups, courts, rng)
        local_state, local_cost = arr.snapshot(), arr.cost

        hot, cold = 2.5, 0.02
        for step in range(iters):
            temp = hot * (cold / hot) ** (step / max(1, iters - 1))
            r = rng.randrange(n_rounds)

            if courts > 1 and rng.random() < 0.6:
                s1, s2 = rng.sample(range(seats_per_round), 2)
                if s1 // COURT_SIZE == s2 // COURT_SIZE:
                    continue
                delta = arr.swap(r, s1, s2)
                undo = lambda: arr.swap(r, s1, s2)  # noqa: E731 - swapping back
            else:
                ci = rng.randrange(courts)
                previous = arr.splits[r][ci]
                choice = rng.randrange(len(SPLITS))
                if choice == previous:
                    continue
                delta = arr.repair(r, ci, choice)
                undo = lambda: arr.repair(r, ci, previous)  # noqa: E731

            if delta <= 0 or rng.random() < math.exp(-delta / temp):
                if arr.cost < local_cost - 1e-9:
                    local_state, local_cost = arr.snapshot(), arr.cost
            else:
                undo()

        if local_cost < best_cost:
            best_state, best_cost = local_state, local_cost

    return best_state


def build_schedule(session: Session, rng: random.Random) -> list[Round]:
    n, r, courts = session.n_players, session.n_rounds, session.courts

    best_att, best_att_cost = None, math.inf
    for _ in range(8):
        att = _greedy_attendance(n, r, session.slots, quotas(n, r, session.slots, rng), rng)
        att, cost = anneal_attendance(att, n, r, rng)
        if cost < best_att_cost:
            best_att, best_att_cost = att, cost
        if best_att_cost <= 0.0:
            break

    lineups = [sorted(s) for s in best_att]
    seats, splits = assign_courts(lineups, courts, rng)

    rounds = []
    for i in range(r):
        matches = []
        for ci in range(courts):
            four = seats[i][ci * COURT_SIZE : (ci + 1) * COURT_SIZE]
            team_a, team_b = _teams(four, splits[i][ci])
            if min(team_b) < min(team_a):
                team_a, team_b = team_b, team_a
            matches.append(Match(court=ci + 1, team_a=tuple(team_a), team_b=tuple(team_b)))
        playing = set(lineups[i])
        rounds.append(
            Round(
                number=i + 1,
                matches=tuple(matches),
                resting=tuple(p for p in range(n) if p not in playing),
                start_min=round(i * session.minutes / r),
                end_min=round((i + 1) * session.minutes / r),
            )
        )
    return rounds


def summarise(rounds: list[Round], n_players: int) -> Stats:
    st = Stats()
    partners: dict[int, set[int]] = {p: set() for p in range(n_players)}
    pair_counts: dict[tuple[int, int], int] = defaultdict(int)

    on_court = [set(rd.playing) for rd in rounds]

    for p in range(n_players):
        played = [rd.number for rd, players in zip(rounds, on_court) if p in players]
        st.games[p] = len(played)
        st.rounds_played[p] = played

        on = off = best_on = best_off = 0
        for players in on_court:
            if p in players:
                on, off = on + 1, 0
            else:
                off, on = off + 1, 0
            best_on, best_off = max(best_on, on), max(best_off, off)
        st.max_streak = max(st.max_streak, best_on)
        st.max_rest_streak = max(st.max_rest_streak, best_off)

    for rd in rounds:
        for match in rd.matches:
            for team in (match.team_a, match.team_b):
                for i, x in enumerate(team):
                    for y in team[i + 1 :]:
                        partners[x].add(y)
                        partners[y].add(x)
                        pair_counts[_key((x, y))] += 1

    st.distinct_partners = {p: len(v) for p, v in partners.items()}
    st.partners = dict(pair_counts)
    return st


# --------------------------------------------------------------------------
# time helpers
# --------------------------------------------------------------------------


def parse_start(value: str) -> datetime:
    raw = value.strip().lower().replace(" ", "").replace(".", "")
    for fmt in ("%H:%M", "%I:%M%p", "%I%p", "%H%M"):
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        return datetime.combine(datetime.today().date(), parsed.time())
    raise argparse.ArgumentTypeError(f"cannot read start time {value!r} - try 19:00 or 7:30pm")


def round_len_text(session: Session) -> str:
    """'15 min' when it divides cleanly, '~13 min' when it does not."""
    mins = session.round_minutes
    if abs(mins - round(mins)) < 0.05:
        return f"{mins:.0f} min"
    return f"~{mins:.0f} min"


def clock(session: Session, minute: int) -> str:
    return (session.start + timedelta(minutes=minute)).strftime("%H:%M")


def slot_label(session: Session, rd: Round, dash: str = "–") -> str:
    if session.start:
        return f"{clock(session, rd.start_min)} {dash} {clock(session, rd.end_min)}"
    return f"{rd.start_min}{dash}{rd.end_min} min"


def play_summary(session: Session, stats: Stats) -> str:
    """'Everyone plays 4 of 7' / '5 or 6 of 9 rounds each'."""
    low, high = min(stats.games.values()), max(stats.games.values())
    if low == high == session.n_rounds:
        return "Everyone plays every round"
    if low == high:
        return f"Everyone plays {low} of {session.n_rounds}"
    return f"{low} or {high} of {session.n_rounds} rounds each"


# --------------------------------------------------------------------------
# pdf
# --------------------------------------------------------------------------

PAGE_W, PAGE_H = 340.0, 620.0
MARGIN = 20.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOT_H = 30.0

BG = HexColor("#F1F5F2")
CARD = HexColor("#FFFFFF")
SHADOW = HexColor("#E0E7E2")
BORDER = HexColor("#E2E9E4")
INK = HexColor("#0D1F1B")
MUTED = HexColor("#6C7F79")
FAINT = HexColor("#9AA8A3")
DEEP = HexColor("#0B3A33")
DEEP_SOFT = HexColor("#C3D8D2")
TEAM_A = HexColor("#0E8C6B")
TEAM_B = HexColor("#E0663A")
BALL = HexColor("#D8F24B")
HAIRLINE = HexColor("#EDF2EE")
EMPTY = HexColor("#EEF2EF")
EMPTY_EDGE = HexColor("#E2E9E4")

DASH = "–"
DOT = "·"


def _fit(c, text: str, width: float, font: str, size: float, min_size: float = 7.0):
    """Shrink then clip so a name never runs past its box."""
    while size > min_size and c.stringWidth(text, font, size) > width:
        size -= 0.25
    if c.stringWidth(text, font, size) > width:
        while text and c.stringWidth(text + "…", font, size) > width:
            text = text[:-1]
        text += "…"
    return text, size


def _spaced(c, text, x, y, font, size, color, space=0.0, align="left"):
    """drawString with optional letter spacing (Tc lives on the text object)."""
    width = c.stringWidth(text, font, size) + space * len(text)
    if align == "right":
        x -= width
    elif align == "center":
        x -= width / 2
    text_obj = c.beginText(x, y)
    text_obj.setFont(font, size)
    text_obj.setFillColor(color)
    if space:
        text_obj.setCharSpace(space)
    text_obj.textOut(text)
    if space:
        text_obj.setCharSpace(0)  # Tc survives ET, so put it back
    c.drawText(text_obj)


def _wrap(c, parts: list[str], width: float, font: str, size: float, sep: str) -> list[str]:
    lines, line = [], ""
    for part in parts:
        trial = f"{line}{sep}{part}" if line else part
        if line and c.stringWidth(trial, font, size) > width:
            lines.append(line)
            line = part
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def _court_glyph(c, x, y, w, h, color, alpha=0.16):
    c.saveState()
    c.setFillAlpha(alpha)
    c.setStrokeAlpha(alpha)
    c.setStrokeColor(color)
    c.setLineWidth(1.2)
    c.roundRect(x, y, w, h, 3, stroke=1, fill=0)
    c.line(x + w / 2, y, x + w / 2, y + h)
    c.setLineWidth(0.7)
    c.line(x + w * 0.22, y + h * 0.16, x + w * 0.22, y + h * 0.84)
    c.line(x + w * 0.78, y + h * 0.16, x + w * 0.78, y + h * 0.84)
    c.line(x + w * 0.22, y + h / 2, x + w * 0.78, y + h / 2)
    c.restoreState()


def _page_bg(c, page_h=PAGE_H):
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, page_h, stroke=0, fill=1)


HERO_H = 108.0
BANNER_H = 46.0


def _courts_text(courts: int) -> str:
    return "1 court" if courts == 1 else f"{courts} courts"


def _hero(c, session: Session, stats: Stats, page_h: float = PAGE_H) -> float:
    top = page_h - HERO_H
    c.setFillColor(DEEP)
    c.rect(0, top, PAGE_W, HERO_H, stroke=0, fill=1)
    _court_glyph(c, PAGE_W - 92, top + 22, 72, 46, BALL, alpha=0.22)

    crumbs = [bit for bit in (session.date_text, session.location) if bit]
    eyebrow = f" {DOT} ".join(crumbs).upper() if crumbs else f"{_courts_text(session.courts)} {DOT} rotation".upper()
    text, size = _fit(c, eyebrow, CONTENT_W - 78, "Helvetica-Bold", 7.4, 6.0)
    _spaced(c, text, MARGIN, page_h - 34, "Helvetica-Bold", size, BALL, space=1.5)

    title, size = _fit(c, session.title, CONTENT_W - 78, "Helvetica-Bold", 22, 13)
    c.setFont("Helvetica-Bold", size)
    c.setFillColor(HexColor("#FFFFFF"))
    c.drawString(MARGIN, page_h - 60, title)

    courts_bit = f"{_courts_text(session.courts)} {DOT} " if session.courts > 1 else ""
    line1 = (
        f"{session.n_players} players {DOT} {courts_bit}{session.n_rounds} rounds {DOT} "
        f"{round_len_text(session)} each"
    )
    resting = session.n_players - session.slots
    line2 = play_summary(session, stats)
    if resting == 0:
        line2 += f" {DOT} the pairings rotate"
    elif stats.max_streak <= 3:
        line2 += f" {DOT} max {stats.max_streak} in a row"
    else:
        line2 += f" {DOT} {resting} resting each round"
    if session.start:
        line2 = f"{clock(session, 0)} {DASH} {clock(session, session.minutes)}  {DOT}  " + line2

    for offset, line in ((78, line1), (92, line2)):
        text, size = _fit(c, line, CONTENT_W, "Helvetica", 8.6, 6.6)
        c.setFont("Helvetica", size)
        c.setFillColor(DEEP_SOFT)
        c.drawString(MARGIN, page_h - offset, text)
    return top - 16


def _banner(c, text: str, page_h: float = PAGE_H) -> float:
    top = page_h - BANNER_H
    c.setFillColor(DEEP)
    c.rect(0, top, PAGE_W, BANNER_H, stroke=0, fill=1)
    label, size = _fit(c, text.upper(), CONTENT_W, "Helvetica-Bold", 8.4, 6.5)
    _spaced(c, label, MARGIN, top + 18, "Helvetica-Bold", size, BALL, space=1.4)
    return top - 16


def _footer(c, session: Session, page: int, total: int):
    y = 18.0
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(MARGIN, y + 13, PAGE_W - MARGIN, y + 13)
    left = f"{session.title} {DOT} {session.minutes} min {DOT} {_courts_text(session.courts)}"
    _spaced(c, left, MARGIN, y, "Helvetica", 7.4, FAINT)
    _spaced(c, f"{page}/{total}", PAGE_W - MARGIN, y, "Helvetica-Bold", 7.4, FAINT, align="right")


# --------------------------------------------------------------------------
# pdf: one card per round
# --------------------------------------------------------------------------

PAD = 11.0
PILL_H = 14.0
TEAM_LINE = 16.0
VS_LINE = 10.0
REST_LINE = 11.0
CARD_GAP = 9.0


def _rest_lines(c, session: Session, rd: Round) -> list[str]:
    names = [session.players[p] for p in rd.resting]
    if not names:
        return []
    width = CONTENT_W - 2 * PAD - 44
    return _wrap(c, names, width, "Helvetica", 8.6, f"  {DOT}  ")


def _card_layout(c, session: Session, rd: Round):
    """Return (height, items) where each item carries its offset from the card top.

    Drawing and measuring both walk this list, so pagination can never disagree
    with what actually gets painted.
    """
    show_court = session.courts > 1
    items: list[tuple] = []
    off = PAD
    items.append(("head", off))
    off += PILL_H

    for i, match in enumerate(rd.matches):
        if i:
            off += 7
            items.append(("rule", off))
            off += 6
        if show_court:
            off += 12
            items.append(("court", off, match.court))
            off += 15
        else:
            off += 20
        items.append(("team", off, match.team_a, TEAM_A))
        items.append(("vs", off + VS_LINE + 1))
        off += TEAM_LINE + VS_LINE
        items.append(("team", off, match.team_b, TEAM_B))

    lines = _rest_lines(c, session, rd)
    if lines:
        off += 13
        items.append(("divider", off))
        off += 12
        items.append(("rest", off, lines))
        off += REST_LINE * (len(lines) - 1) + 9
    else:
        off += 11
    return off, items


def _card_height(c, session: Session, rd: Round) -> float:
    return _card_layout(c, session, rd)[0]


def _draw_card(c, session: Session, rd: Round, y_top: float) -> float:
    height, items = _card_layout(c, session, rd)
    x, w = MARGIN, CONTENT_W
    bottom = y_top - height

    c.setFillColor(SHADOW)
    c.roundRect(x, bottom - 1.6, w, height, 10, stroke=0, fill=1)
    c.setFillColor(CARD)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.9)
    c.roundRect(x, bottom, w, height, 10, stroke=1, fill=1)

    text_x = x + PAD + 9
    text_w = w - 2 * PAD - 9

    for item in items:
        kind, off = item[0], item[1]
        y = y_top - off

        if kind == "head":
            label = f"ROUND {rd.number}"
            pill_w = c.stringWidth(label, "Helvetica-Bold", 7.6) + 8 * 1.1 + 14
            c.setFillColor(DEEP)
            c.roundRect(x + PAD, y - PILL_H, pill_w, PILL_H, PILL_H / 2, stroke=0, fill=1)
            _spaced(c, label, x + PAD + 7, y - PILL_H + 4.4, "Helvetica-Bold", 7.6, BALL, space=1.1)
            _spaced(
                c,
                slot_label(session, rd),
                x + w - PAD,
                y - PILL_H + 4.4,
                "Helvetica-Bold",
                9.2,
                INK,
                align="right",
            )

        elif kind == "rule":
            c.setStrokeColor(HAIRLINE)
            c.setLineWidth(1)
            c.line(x + PAD, y, x + w - PAD, y)

        elif kind == "court":
            _spaced(c, f"COURT {item[2]}", x + PAD, y, "Helvetica-Bold", 7.0, MUTED, space=1.1)

        elif kind == "team":
            team, color = item[2], item[3]
            c.setFillColor(color)
            c.roundRect(x + PAD, y - 2.5, 3.6, 13.5, 1.8, stroke=0, fill=1)
            names = "  &  ".join(session.players[p] for p in team)
            text, size = _fit(c, names, text_w, "Helvetica-Bold", 12.6, 8.0)
            c.setFont("Helvetica-Bold", size)
            c.setFillColor(INK)
            c.drawString(text_x, y, text)

        elif kind == "vs":
            _spaced(c, "VS", text_x, y, "Helvetica-Bold", 6.6, FAINT, space=1.0)

        elif kind == "divider":
            c.setStrokeColor(HAIRLINE)
            c.setLineWidth(1)
            c.line(x + PAD, y, x + w - PAD, y)

        elif kind == "rest":
            _spaced(c, "RESTING", x + PAD, y, "Helvetica-Bold", 6.8, FAINT, space=0.9)
            c.setFont("Helvetica", 8.6)
            c.setFillColor(MUTED)
            for i, line in enumerate(item[2]):
                c.drawString(x + PAD + 44, y - i * REST_LINE, line)

    return bottom


# --------------------------------------------------------------------------
# pdf: the at-a-glance grid
# --------------------------------------------------------------------------

GRID_ROW_H = 20.0
GLANCE_HEAD_H = 16 + 6 + 15
LEGEND_H = 26.0


def _glance_header(c, session: Session, y: float, grid_x: float, col_w: float) -> float:
    _spaced(c, "WHO IS ON COURT", MARGIN, y, "Helvetica-Bold", 7.6, MUTED, space=1.2)
    y -= 16
    for i in range(session.n_rounds):
        cx = grid_x + col_w * i + col_w / 2
        _spaced(c, f"R{i + 1}", cx, y, "Helvetica-Bold", 7.2, FAINT, align="center")
    _spaced(c, "PLAYS", PAGE_W - MARGIN, y, "Helvetica-Bold", 7.2, FAINT, align="right")
    y -= 6
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    return y - 15


def _glance_rows(c, session, rounds, stats, players, y, grid_x, col_w, cell_w) -> float:
    cell_h = 14.0
    show_court = session.courts > 1 and cell_w >= 11.0

    for row, p in enumerate(players):
        if row % 2 == 0:
            c.setFillColor(CARD)
            c.roundRect(MARGIN - 4, y - 5.5, CONTENT_W + 8, GRID_ROW_H - 2, 5, stroke=0, fill=1)
        text, size = _fit(c, session.players[p], 88.0, "Helvetica-Bold", 9.4, 6.5)
        c.setFont("Helvetica-Bold", size)
        c.setFillColor(INK)
        c.drawString(MARGIN, y, text)

        for rd in rounds:
            cx = grid_x + col_w * (rd.number - 1) + col_w / 2
            box_x, box_y = cx - cell_w / 2, y - 3.2
            side = rd.side_of(p)
            if side is None:
                c.setFillColor(EMPTY)
                c.setStrokeColor(EMPTY_EDGE)
                c.setLineWidth(0.8)
                c.roundRect(box_x, box_y, cell_w, cell_h, 4, stroke=1, fill=1)
            else:
                c.setFillColor(TEAM_A if side == "a" else TEAM_B)
                c.roundRect(box_x, box_y, cell_w, cell_h, 4, stroke=0, fill=1)
                if show_court:
                    _spaced(
                        c,
                        str(rd.court_of(p)),
                        cx,
                        y,
                        "Helvetica-Bold",
                        7.0,
                        HexColor("#FFFFFF"),
                        align="center",
                    )

        _spaced(
            c, str(stats.games[p]), PAGE_W - MARGIN, y, "Helvetica-Bold", 9.4, MUTED, align="right"
        )
        y -= GRID_ROW_H
    return y


def _glance_legend(c, session: Session, rounds, y: float) -> float:
    y -= 4
    legend = [("Team 1", TEAM_A), ("Team 2", TEAM_B)]
    if any(rd.resting for rd in rounds):
        legend.append(("Resting", EMPTY))
    lx = MARGIN
    for text, color in legend:
        c.setFillColor(color)
        if color is EMPTY:
            c.setStrokeColor(HexColor("#DCE4DF"))
            c.setLineWidth(0.8)
            c.roundRect(lx, y - 1, 12, 9, 3, stroke=1, fill=1)
        else:
            c.roundRect(lx, y - 1, 12, 9, 3, stroke=0, fill=1)
        _spaced(c, text, lx + 16, y, "Helvetica", 7.6, MUTED)
        lx += 16 + c.stringWidth(text, "Helvetica", 7.6) + 14
    if session.courts > 1:
        _spaced(c, "number = court", lx, y, "Helvetica", 7.6, FAINT)
    return y - 22


def _glance_metrics(session: Session):
    name_w, games_w = 92.0, 32.0
    grid_x = MARGIN + name_w
    col_w = (CONTENT_W - name_w - games_w) / session.n_rounds
    cell_w = max(6.0, min(col_w - 3, 22.0))
    return grid_x, col_w, cell_w


# --------------------------------------------------------------------------
# pdf: notes
# --------------------------------------------------------------------------


def _note_bullets(session: Session, stats: Stats) -> list[str]:
    low, high = min(stats.games.values()), max(stats.games.values())
    spread = min(stats.distinct_partners.values())
    mins = session.round_minutes

    if low == high == session.n_rounds:
        fair = (
            f"With {session.n_players} players on {_courts_text(session.courts)} nobody sits out "
            f"{DOT} every round re-draws the pairings."
        )
    elif low == high:
        fair = (
            f"Everyone plays {low} of {session.n_rounds} rounds {DOT} "
            f"{low * mins:.0f} minutes on court each."
        )
    else:
        fair = (
            f"Court time is as even as {session.n_players} players on "
            f"{_courts_text(session.courts)} allow: {low} or {high} rounds each."
        )

    bullets = [fair]
    if stats.max_rest_streak:
        if stats.max_streak <= 3:
            bullets.append(
                f"Nobody plays more than {stats.max_streak} rounds in a row, "
                f"or sits out more than {stats.max_rest_streak}."
            )
        else:
            resting = session.n_players - session.slots
            who = "1 player sits" if resting == 1 else f"{resting} players sit"
            bullets.append(
                f"Only {who} out at a time, so runs on court are long by necessity "
                f"{DOT} the rests are spread as evenly as they go."
            )
    bullets.append(f"Partners are mixed up: at least {spread} different team-mates each.")
    swap = f"Swap at the end of every round {DOT} {round_len_text(session)}"
    if session.courts > 1:
        swap += ", check the card for your court."
    else:
        swap += ", winners stay on their side."
    bullets.append(swap)
    return bullets


def _note_lines(c, bullets: list[str]) -> list[list[str]]:
    return [_wrap(c, text.split(" "), CONTENT_W - 44, "Helvetica", 8.6, " ") for text in bullets]


def _notes_height(c, bullets: list[str]) -> float:
    wrapped = _note_lines(c, bullets)
    return 20 + sum(22 + 10.5 * (len(lines) - 1) for lines in wrapped)


def _notes(c, bullets: list[str], seed: int, y: float):
    box_h = _notes_height(c, bullets)
    c.setFillColor(CARD)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.9)
    c.roundRect(MARGIN, y - box_h, CONTENT_W, box_h, 10, stroke=1, fill=1)

    ty = y - 20
    for lines in _note_lines(c, bullets):
        c.setFillColor(BALL)
        c.circle(MARGIN + 15, ty + 3, 3.2, stroke=0, fill=1)
        c.setFillColor(DEEP)
        c.circle(MARGIN + 15, ty + 3, 1.3, stroke=0, fill=1)
        c.setFont("Helvetica", 8.6)
        c.setFillColor(MUTED)
        for i, line in enumerate(lines):
            c.drawString(MARGIN + 26, ty - i * 10.5, line)
        ty -= 22 + 10.5 * (len(lines) - 1)

    _spaced(
        c,
        f"generated {datetime.now():%d %b %Y} {DOT} seed {seed}",
        MARGIN,
        y - box_h - 14,
        "Helvetica",
        6.8,
        FAINT,
    )


# --------------------------------------------------------------------------
# pdf: pagination and render
# --------------------------------------------------------------------------


def _paginate_cards(c, session: Session, rounds: list[Round]):
    pages: list[list[tuple[Round, float]]] = []
    current: list[tuple[Round, float]] = []
    y = PAGE_H - HERO_H - 16
    for rd in rounds:
        height = _card_height(c, session, rd)
        if current and y - height < FOOT_H + 12:
            pages.append(current)
            current = []
            y = PAGE_H - BANNER_H - 16
        current.append((rd, height))
        y -= height + CARD_GAP
    if current:
        pages.append(current)
    return pages


def _card_page_height(cards, first: bool) -> float:
    chrome = (HERO_H if first else BANNER_H) + 16
    content = sum(h for _, h in cards) + CARD_GAP * (len(cards) - 1)
    return max(260.0, min(PAGE_H, chrome + content + 12 + FOOT_H))


def _paginate_glance(session: Session, notes_h: float) -> list[list[int]]:
    """Chunk the player rows so a big group still gets a tidy summary."""
    usable = PAGE_H - BANNER_H - 16 - FOOT_H - 12 - GLANCE_HEAD_H
    per_page = max(1, int(usable // GRID_ROW_H))
    last_page = max(1, int((usable - LEGEND_H - notes_h - 20) // GRID_ROW_H))

    n = session.n_players
    if n <= last_page:
        return [list(range(n))]

    pages = 2
    while (pages - 1) * per_page + last_page < n:
        pages += 1

    # fill the pages evenly rather than leaving one name stranded at the end
    tail = min(last_page, max(1, n // pages))
    chunks: list[list[int]] = []
    start, left = 0, n - tail
    for i in range(pages - 1):
        size = -(-left // (pages - 1 - i))  # ceiling division of what remains
        chunks.append(list(range(start, start + size)))
        start += size
        left -= size
    chunks.append(list(range(start, n)))
    return chunks


def render_pdf(path, session, rounds, stats, seed, total_pages=None) -> int:
    buffer = BytesIO() if total_pages is None else None
    c = pdfcanvas.Canvas(buffer or path, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(session.title)
    c.setAuthor("padel.py")
    c.setSubject(
        f"{session.n_players} players, {_courts_text(session.courts)}, {session.minutes} minutes"
    )

    page = 0
    for index, cards in enumerate(_paginate_cards(c, session, rounds)):
        page += 1
        height = _card_page_height(cards, first=index == 0)
        c.setPageSize((PAGE_W, height))
        _page_bg(c, height)
        if index == 0:
            y = _hero(c, session, stats, height)
        else:
            y = _banner(c, f"{session.title} {DOT} continued", height)
        for rd, _ in cards:
            y = _draw_card(c, session, rd, y) - CARD_GAP
        _footer(c, session, page, total_pages or page)
        c.showPage()

    # the summary pages are trimmed to their own content, so they never end in
    # half a page of empty paper on someone's phone
    bullets = _note_bullets(session, stats)
    notes_h = _notes_height(c, bullets)
    grid_x, col_w, cell_w = _glance_metrics(session)
    chunks = _paginate_glance(session, notes_h)

    for index, players in enumerate(chunks):
        page += 1
        last = index == len(chunks) - 1
        needed = BANNER_H + 20 + GLANCE_HEAD_H + GRID_ROW_H * len(players) + 12 + FOOT_H
        if last:
            needed += LEGEND_H + notes_h + 20
        height = max(260.0, min(PAGE_H, needed))
        c.setPageSize((PAGE_W, height))

        _page_bg(c, height)
        heading = "At a glance" if index == 0 else f"At a glance {DOT} continued"
        y = _banner(c, heading, height) - 4
        y = _glance_header(c, session, y, grid_x, col_w)
        y = _glance_rows(c, session, rounds, stats, players, y, grid_x, col_w, cell_w)
        if last:
            y = _glance_legend(c, session, rounds, y)
            _notes(c, bullets, seed, y)
        _footer(c, session, page, total_pages or page)
        c.showPage()

    c.save()
    if buffer is not None:
        return render_pdf(path, session, rounds, stats, seed, total_pages=page)
    return page


# --------------------------------------------------------------------------
# console
# --------------------------------------------------------------------------


def print_schedule(session: Session, rounds: list[Round], stats: Stats):
    width = 46
    print()
    print(session.title.upper())
    print("-" * width)
    head = f"{session.n_players} players | {_courts_text(session.courts)} | {session.minutes} min"
    if session.start:
        head += f" | {clock(session, 0)}-{clock(session, session.minutes)}"
    print(head)
    if session.location:
        print(session.location)
    print("-" * width)

    for rd in rounds:
        print(f"\nRound {rd.number}  ({slot_label(session, rd, dash='-')})")
        for match in rd.matches:
            prefix = f"  Court {match.court}: " if session.courts > 1 else "  "
            names_a = " & ".join(session.players[p] for p in match.team_a)
            names_b = " & ".join(session.players[p] for p in match.team_b)
            if session.courts > 1:
                print(f"{prefix}{names_a}  vs  {names_b}")
            else:
                print(f"  {names_a}")
                print("  vs")
                print(f"  {names_b}")
        if rd.resting:
            print("  resting: " + ", ".join(session.players[p] for p in rd.resting))

    print("\n" + "-" * width)
    name_w = max(len(p) for p in session.players)
    print(f"{'player':<{name_w}}  {'rounds':<18} plays")
    for p, name in enumerate(session.players):
        played = ",".join(str(r) for r in stats.rounds_played[p])
        print(f"{name:<{name_w}}  {played:<18} {stats.games[p]}")
    print(
        f"\nmax rounds in a row: {stats.max_streak} | "
        f"max rounds resting in a row: {stats.max_rest_streak}"
    )


# --------------------------------------------------------------------------
# build it all
# --------------------------------------------------------------------------


def generate(session: Session, seed: int | None = None):
    """Schedule a session. Returns (rounds, stats, seed)."""
    if seed is None:
        seed = random.randrange(1, 10**6)
    rng = random.Random(seed)
    rounds = build_schedule(session, rng)
    return rounds, summarise(rounds, session.n_players), seed


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------


def clean_names(raw: list[str]) -> tuple[list[str], str | None]:
    """Strip blanks, reject duplicates. Returns (names, error)."""
    names, seen = [], set()
    for name in raw:
        name = name.strip()
        if not name:
            continue
        if name.lower() in seen:
            return names, f"duplicate name {name!r} - everyone needs a unique name"
        seen.add(name.lower())
        names.append(name)
    return names, None


def check_roster(names: list[str], courts: int) -> str | None:
    """The one rule that matters: enough players to fill every court."""
    need = min_players(courts)
    if len(names) < need:
        short = need - len(names)
        verb = "needs" if courts == 1 else "need"
        return (
            f"{_courts_text(courts)} {verb} at least {need} players, got {len(names)}"
            f" - add {short} more"
        )
    if len(names) > MAX_PLAYERS:
        return f"that is {len(names)} players; this tops out at {MAX_PLAYERS}"
    return None


def load_players(args) -> list[str]:
    """Names come from --players, --players-file, or DEFAULT_PLAYERS."""
    if args.players_file:
        with open(args.players_file, encoding="utf-8") as fh:
            raw = [line.strip() for line in fh]
        source = f"--players-file {args.players_file}"
    elif args.players:
        raw = [n.strip() for n in args.players.replace("\n", ",").split(",")]
        source = "--players"
    else:
        raw = list(DEFAULT_PLAYERS)
        source = "DEFAULT_PLAYERS in padel.py"

    names, error = clean_names(raw)
    if error:
        sys.exit(f"{error} (from {source})")
    error = check_roster(names, args.courts)
    if error:
        sys.exit(f"{error} (from {source})")
    return names


def main(argv=None):
    ap = argparse.ArgumentParser(description="Padel rotation scheduler -> phone-friendly PDF.")
    ap.add_argument("--players", help='comma separated names, e.g. "Ann,Ben,Cara,Dan"')
    ap.add_argument("--players-file", help="text file with one name per line")
    ap.add_argument("--courts", type=int, default=1, help="how many courts are booked (default 1)")
    ap.add_argument("--minutes", type=int, default=90, help="session length (default 90)")
    ap.add_argument("--rounds", type=int, help="number of rounds (default: chosen for you)")
    ap.add_argument("--start", type=parse_start, help="start time, e.g. 8:00 or 7:30pm")
    ap.add_argument("--location", default="", help="where you are playing, shown on the PDF")
    ap.add_argument("--title", default="Padel Rotation", help="heading on the PDF")
    ap.add_argument("--date", dest="date_text", default="", help="eyebrow text, e.g. 'Sat 21 Sep'")
    ap.add_argument("--seed", type=int, help="reuse a seed to regenerate the same rotation")
    ap.add_argument("-o", "--out", default="padel-rotation.pdf", help="output PDF path")
    ap.add_argument("--open", action="store_true", help="open the PDF when it is done")
    ap.add_argument("--quiet", action="store_true", help="skip the console schedule")
    args = ap.parse_args(argv)

    if not 1 <= args.courts <= MAX_COURTS:
        sys.exit(f"courts must be between 1 and {MAX_COURTS}")
    players = load_players(args)

    n_rounds = args.rounds or choose_rounds(args.minutes, len(players), args.courts)
    if n_rounds < 1:
        sys.exit("need at least one round")

    session = Session(
        players=players,
        minutes=args.minutes,
        n_rounds=n_rounds,
        courts=args.courts,
        start=args.start,
        title=args.title,
        date_text=args.date_text,
        location=args.location,
    )
    rounds, stats, seed = generate(session, args.seed)

    if not args.quiet:
        print_schedule(session, rounds, stats)

    pages = render_pdf(args.out, session, rounds, stats, seed)
    path = os.path.abspath(args.out)
    print(f"\nPDF: {path}  ({pages} pages, seed {seed})")

    if args.open:
        os.startfile(path)  # noqa: S606 - windows convenience


if __name__ == "__main__":
    main()
