#!/usr/bin/env python3
"""
Padel rotation scheduler - desktop front end.

Fill in the courts, the players, where and when you are playing, then click
Generate. Names and locations you have used before are suggested as you type.

    py padel_gui.py

The scheduling and PDF work all lives in padel.py next door.
"""

from __future__ import annotations

import calendar
import json
import os
import queue
import re
import sys
import threading
import tkinter as tk
from datetime import date, datetime, timedelta
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

sys.path.insert(0, str(Path(__file__).resolve().parent))

import padel  # noqa: E402  - needs the path above


def app_dir() -> Path:
    """Where to keep settings.

    Packaged as an .exe this has to be the folder holding the executable: a
    one-file build unpacks itself into a temp folder that is deleted on exit,
    so anything written next to __file__ would be gone by the next launch.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_path(name: str) -> Path:
    """A file shipped with the app.

    A one-file PyInstaller build unpacks its data into sys._MEIPASS, so bundled
    files live there rather than next to the executable.
    """
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else None
    return (base or Path(__file__).resolve().parent) / name


HISTORY_PATH = app_dir() / "padel_history.json"
MAX_HISTORY = 200
MAX_SUGGESTIONS = 6

DEEP = "#0B3A33"
BALL = "#D8F24B"
INK = "#0D1F1B"
MUTED = "#5E706B"
DANGER = "#B42318"
PAPER = "#F1F5F2"
LINE = "#C9D6D1"


def apply_icon(window: tk.Tk) -> None:
    """Put the racket on the title bar, the taskbar and the alt-tab list."""
    ico = resource_path("assets/icon.ico")
    if ico.is_file():
        try:
            window.iconbitmap(default=str(ico))
            return
        except tk.TclError:
            pass  # not Windows, or a Tk that dislikes the file - try the PNG
    png = resource_path("assets/icon.png")
    if png.is_file():
        try:
            window._icon = tk.PhotoImage(file=str(png))  # a reference has to survive
            window.iconphoto(True, window._icon)
        except tk.TclError:
            pass


# --------------------------------------------------------------------------
# remembering names and places
# --------------------------------------------------------------------------


def load_history() -> dict:
    blank = {"players": [], "locations": [], "last": {}}
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return blank
    if not isinstance(data, dict):
        return blank
    for key in ("players", "locations"):
        values = data.get(key)
        data[key] = [v for v in values if isinstance(v, str)] if isinstance(values, list) else []
    if not isinstance(data.get("last"), dict):
        data["last"] = {}
    return data


def save_history(data: dict) -> None:
    try:
        HISTORY_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError:
        pass  # a read-only folder should never break the app


def remember(existing: list[str], fresh: list[str]) -> list[str]:
    """Most recently used first, case-insensitive de-dupe, capped."""
    merged, seen = [], set()
    for value in [v.strip() for v in fresh] + existing:
        if not value or value.lower() in seen:
            continue
        seen.add(value.lower())
        merged.append(value)
    return merged[:MAX_HISTORY]


# --------------------------------------------------------------------------
# an entry that suggests as you type
# --------------------------------------------------------------------------

SKIP_KEYS = {
    "Up", "Down", "Left", "Right", "Return", "Tab", "Escape", "Shift_L", "Shift_R",
    "Control_L", "Control_R", "Alt_L", "Alt_R", "Home", "End", "Prior", "Next",
}


class AutocompleteEntry(ttk.Entry):
    """Entry with inline completion plus a dropdown of past values."""

    def __init__(self, master, pool, **kwargs):
        super().__init__(master, **kwargs)
        self._pool = pool  # callable returning the current suggestion list
        self._popup: tk.Toplevel | None = None
        self._list: tk.Listbox | None = None
        self._hide_job = None

        self.bind("<KeyRelease>", self._on_key)
        self.bind("<FocusOut>", self._on_focus_out)
        self.bind("<Escape>", lambda _e: self._hide())
        self.bind("<Down>", self._on_down)
        self.bind("<Up>", self._on_up)
        self.bind("<Return>", self._on_accept)
        self.bind("<Tab>", self._on_accept)
        self.bind("<Destroy>", lambda _e: self._hide())

    # -- matching ---------------------------------------------------------

    def _matches(self, text: str) -> list[str]:
        if not text:
            return []
        low = text.lower()
        pool = [v for v in self._pool() if v.lower() != low]  # nothing to suggest once it matches
        starts = [v for v in pool if v.lower().startswith(low)]
        contains = [v for v in pool if low in v.lower() and v not in starts]
        return (starts + contains)[:MAX_SUGGESTIONS]

    def _on_key(self, event):
        if event.keysym in SKIP_KEYS:
            return
        text = self.get()
        matches = self._matches(text)
        if not matches:
            self._hide()
            return

        # inline completion: fill in the rest and leave it selected
        if event.keysym not in ("BackSpace", "Delete") and self.selection_present() is False:
            best = matches[0]
            if best.lower().startswith(text.lower()) and len(best) > len(text):
                self.delete(0, tk.END)
                self.insert(0, best)
                self.icursor(len(text))
                self.selection_range(len(text), tk.END)

        self._show(matches)

    # -- the dropdown -----------------------------------------------------

    def _show(self, matches: list[str]):
        if self._popup is None:
            self._popup = tk.Toplevel(self)
            self._popup.overrideredirect(True)
            self._popup.attributes("-topmost", True)
            self._list = tk.Listbox(
                self._popup,
                activestyle="none",
                highlightthickness=0,
                borderwidth=1,
                relief="solid",
                font=("Segoe UI", 9),
                selectbackground=DEEP,
                selectforeground="white",
            )
            self._list.pack(fill="both", expand=True)
            self._list.bind("<ButtonRelease-1>", self._on_click)
            self._list.bind("<Motion>", self._on_hover)

        self._list.delete(0, tk.END)
        for value in matches:
            self._list.insert(tk.END, value)
        self._list.configure(height=len(matches))

        self.update_idletasks()
        x = self.winfo_rootx()
        y = self.winfo_rooty() + self.winfo_height()
        self._popup.geometry(f"{max(self.winfo_width(), 140)}x{len(matches) * 18 + 4}+{x}+{y}")
        self._popup.deiconify()
        self._popup.lift()

    def _hide(self):
        if self._hide_job is not None:
            try:
                self.after_cancel(self._hide_job)
            except tk.TclError:
                pass
            self._hide_job = None
        if self._popup is not None:
            try:
                self._popup.destroy()
            except tk.TclError:
                pass
            self._popup = None
            self._list = None

    def _on_focus_out(self, _event):
        # a click on the dropdown also fires FocusOut, so give it a moment
        self._hide_job = self.after(180, self._hide)

    def _visible(self) -> bool:
        return self._popup is not None and self._list is not None

    # -- keyboard and mouse on the list -----------------------------------

    def _move(self, step: int):
        if not self._visible():
            return
        size = self._list.size()
        if not size:
            return
        current = self._list.curselection()
        index = (current[0] + step) % size if current else (0 if step > 0 else size - 1)
        self._list.selection_clear(0, tk.END)
        self._list.selection_set(index)
        self._list.see(index)

    def _on_down(self, _event):
        if not self._visible():
            self._show(self._matches(self.get()) or self._pool()[:MAX_SUGGESTIONS])
            return "break"
        self._move(1)
        return "break"

    def _on_up(self, _event):
        self._move(-1)
        return "break"

    def _take(self, value: str):
        self.delete(0, tk.END)
        self.insert(0, value)
        self.icursor(tk.END)
        self._hide()

    def _on_accept(self, _event):
        if self._visible():
            current = self._list.curselection()
            if current:
                self._take(self._list.get(current[0]))
                return "break"
            self.selection_clear()
            self._hide()
        return None

    def _on_click(self, _event):
        if self._visible():
            current = self._list.curselection()
            if current:
                value = self._list.get(current[0])
                self._take(value)
                self.focus_set()
        return "break"

    def _on_hover(self, event):
        if self._visible():
            index = self._list.nearest(event.y)
            self._list.selection_clear(0, tk.END)
            self._list.selection_set(index)


# --------------------------------------------------------------------------
# picking a date and a time
# --------------------------------------------------------------------------

DATE_FORMAT = "%a %d %b"  # what lands in the box, and on the PDF
DATE_READS = (
    "%a %d %b %Y", "%a %d %b", "%d %b %Y", "%d %b", "%d %B %Y", "%d %B",
    "%Y-%m-%d", "%d/%m/%Y", "%d/%m",
)


def parse_date_text(text: str) -> date | None:
    """Read back whatever is in the date box, so the calendar opens on it."""
    raw = " ".join(text.replace(",", " ").split())
    for fmt in DATE_READS:
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        return parsed.date() if "%Y" in fmt else parsed.date().replace(year=date.today().year)
    return None


def parse_time_text(text: str) -> tuple[int, int] | None:
    raw = text.strip().lower().replace(" ", "").replace(".", "")
    for fmt in ("%H:%M", "%I:%M%p", "%I%p", "%H%M"):
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        return parsed.hour, parsed.minute
    return None


class Popover(tk.Toplevel):
    """A borderless panel hanging under a field, closed by Escape or a click away."""

    def __init__(self, anchor: tk.Widget):
        super().__init__(anchor)
        self.anchor = anchor
        self.withdraw()
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(bg=LINE)  # one pixel of padding shows as a hairline border
        self.body = tk.Frame(self, bg="white")
        self.body.pack(fill="both", expand=True, padx=1, pady=1)
        self.bind("<Escape>", lambda _e: self.close())
        self.bind("<MouseWheel>", lambda _e: "break")  # not the roster behind us
        self.bind("<Button-1>", self._click, add="+")
        # the grab below sends stray clicks here, but bind_all catches the ones
        # a window manager delivers elsewhere
        self.bind_all("<Button-1>", self._click, add="+")

    def open_under(self, widget: tk.Widget):
        self.update_idletasks()
        width, height = self.winfo_reqwidth(), self.winfo_reqheight()
        x = widget.winfo_rootx()
        y = widget.winfo_rooty() + widget.winfo_height() + 2
        x = max(0, min(x, self.winfo_screenwidth() - width))
        if y + height > self.winfo_screenheight():  # no room below, sit above instead
            y = max(0, widget.winfo_rooty() - height - 2)
        self.geometry(f"{width}x{height}+{x}+{y}")
        self.deiconify()
        self.lift()
        self.grab_set()  # everything the app sees now arrives here
        self.focus_set()

    def _click(self, event):
        # with the grab on, clicks anywhere in the app land here; only the ones
        # outside our own rectangle mean "close"
        if not self.winfo_exists():
            return
        inside = (
            0 <= event.x_root - self.winfo_rootx() < self.winfo_width()
            and 0 <= event.y_root - self.winfo_rooty() < self.winfo_height()
        )
        if not inside:
            self.close()

    def close(self):
        try:
            self.unbind_all("<Button-1>")
            self.grab_release()
            self.destroy()
        except tk.TclError:
            pass


class CalendarPopover(Popover):
    """A month at a time, click a day."""

    def __init__(self, anchor: tk.Widget, selected: date, on_pick):
        super().__init__(anchor)
        self.selected = selected
        self.on_pick = on_pick
        self.shown = selected.replace(day=1)
        self.cells: list[tk.Label] = []

        head = tk.Frame(self.body, bg=DEEP)
        head.pack(fill="x")
        self._arrow(head, "‹", -1).pack(side="left", padx=(6, 0), pady=4)
        self.title_label = tk.Label(
            head, bg=DEEP, fg="white", font=("Segoe UI", 10, "bold")
        )
        self.title_label.pack(side="left", expand=True, pady=4)
        self._arrow(head, "›", 1).pack(side="right", padx=(0, 6), pady=4)

        grid = tk.Frame(self.body, bg="white", padx=6, pady=4)
        grid.pack()
        for col, day in enumerate(("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")):
            tk.Label(
                grid, text=day, bg="white", fg=MUTED, font=("Segoe UI", 8), width=3
            ).grid(row=0, column=col, pady=(0, 2))
        for index in range(42):
            cell = tk.Label(grid, bg="white", width=3, font=("Segoe UI", 9), cursor="hand2")
            cell.grid(row=index // 7 + 1, column=index % 7, padx=1, pady=1)
            cell.bind("<Button-1>", lambda _e, i=index: self._pick(i))
            cell.bind("<Enter>", lambda _e, i=index: self._hover(i, True))
            cell.bind("<Leave>", lambda _e, i=index: self._hover(i, False))
            self.cells.append(cell)

        foot = tk.Frame(self.body, bg="white")
        foot.pack(fill="x", padx=8, pady=(0, 6))
        today = tk.Label(
            foot, text="Today", bg="white", fg=DEEP, font=("Segoe UI", 9, "underline"),
            cursor="hand2",
        )
        today.pack(side="left")
        today.bind("<Button-1>", lambda _e: self._choose(date.today()))

        self._draw()
        self.open_under(anchor)

    def _arrow(self, parent, glyph: str, step: int) -> tk.Label:
        label = tk.Label(
            parent, text=glyph, bg=DEEP, fg="white", font=("Segoe UI", 12), cursor="hand2",
            padx=6,
        )
        label.bind("<Button-1>", lambda _e: self._shift(step))
        return label

    def _shift(self, months: int):
        month = self.shown.month - 1 + months
        self.shown = date(self.shown.year + month // 12, month % 12 + 1, 1)
        self._draw()

    def _days(self) -> list[date]:
        first = self.shown - timedelta(days=self.shown.weekday())  # back to the Monday
        return [first + timedelta(days=offset) for offset in range(42)]

    def _draw(self):
        self.title_label.configure(
            text=f"{calendar.month_name[self.shown.month]} {self.shown.year}"
        )
        today = date.today()
        for cell, day in zip(self.cells, self._days()):
            cell.day = day
            if day == self.selected:
                colours = dict(bg=DEEP, fg="white")
            elif day == today:
                colours = dict(bg=BALL, fg=INK)
            elif day.month != self.shown.month:
                colours = dict(bg="white", fg="#B4C2BD")
            else:
                colours = dict(bg="white", fg=INK)
            cell.rest = colours
            cell.configure(text=str(day.day), **colours)

    def _hover(self, index: int, entering: bool):
        cell = self.cells[index]
        if entering and cell.rest["bg"] == "white":
            cell.configure(bg=PAPER)
        elif not entering:
            cell.configure(**cell.rest)

    def _pick(self, index: int):
        self._choose(self.cells[index].day)

    def _choose(self, day: date):
        self.on_pick(day)
        self.close()


class TimePopover(Popover):
    """Two wheels - hours, and minutes in fives - that you spin or click."""

    STEP = 5
    VISIBLE = 5

    def __init__(self, anchor: tk.Widget, hour: int, minute: int, on_pick):
        super().__init__(anchor)
        self.on_pick = on_pick

        wheels = tk.Frame(self.body, bg="white", padx=10, pady=8)
        wheels.pack()
        self.hours = self._wheel(wheels, [f"{h:02d}" for h in range(24)])
        self.hours.pack(side="left")
        tk.Label(wheels, text=":", bg="white", fg=INK, font=("Segoe UI", 14, "bold")).pack(
            side="left", padx=4
        )
        self.minutes = self._wheel(
            wheels, [f"{m:02d}" for m in range(0, 60, self.STEP)]
        )
        self.minutes.pack(side="left")

        self._select(self.hours, hour)
        self._select(self.minutes, round(minute / self.STEP) % (60 // self.STEP))

        foot = tk.Frame(self.body, bg="white")
        foot.pack(fill="x", padx=10, pady=(0, 8))
        now = tk.Label(
            foot, text="Now", bg="white", fg=DEEP, font=("Segoe UI", 9, "underline"),
            cursor="hand2",
        )
        now.pack(side="left")
        now.bind("<Button-1>", lambda _e: self._set_now())
        tk.Button(
            foot, text="Done", command=self.close, bg=DEEP, fg="white", relief="flat",
            activebackground="#12564C", activeforeground="white",
            font=("Segoe UI", 9, "bold"), padx=12, cursor="hand2",
        ).pack(side="right")

        self.bind("<Return>", lambda _e: self.close())
        self.open_under(anchor)

    def _wheel(self, parent, values: list[str]) -> tk.Listbox:
        box = tk.Listbox(
            parent,
            height=self.VISIBLE,
            width=3,
            exportselection=False,
            activestyle="none",
            highlightthickness=0,
            borderwidth=1,
            relief="solid",
            justify="center",
            font=("Segoe UI", 13),
            selectbackground=DEEP,
            selectforeground="white",
        )
        for value in values:
            box.insert(tk.END, value)
        # our own wheel handler, so the roster canvas behind us does not scroll too
        box.bind("<MouseWheel>", lambda e, b=box: self._scroll(b, e))
        box.bind("<<ListboxSelect>>", lambda _e: self._changed())
        return box

    def _scroll(self, box: tk.Listbox, event) -> str:
        box.yview_scroll(-event.delta // 120, "units")
        return "break"

    def _select(self, box: tk.Listbox, index: int):
        box.selection_clear(0, tk.END)
        box.selection_set(index)
        box.yview(max(0, index - self.VISIBLE // 2))  # keep the pick mid-wheel

    def _value(self, box: tk.Listbox) -> int:
        current = box.curselection()
        return int(box.get(current[0])) if current else 0

    def _changed(self):
        self.on_pick(self._value(self.hours), self._value(self.minutes))

    def _set_now(self):
        now = datetime.now()
        self._select(self.hours, now.hour)
        self._select(self.minutes, round(now.minute / self.STEP) % (60 // self.STEP))
        self._changed()


class PickerField(ttk.Frame):
    """A typed-in value with a button that opens a popover next to it."""

    def __init__(self, master, textvariable: tk.StringVar, glyph: str, width: int):
        super().__init__(master)
        self.var = textvariable
        self.entry = ttk.Entry(self, textvariable=textvariable, width=width)
        self.entry.pack(side="left", fill="x", expand=True)
        self.button = tk.Button(
            self, text=glyph, command=self.open, bg="white", fg=DEEP, relief="solid",
            activebackground=PAPER, activeforeground=DEEP, font=("Segoe UI", 8),
            width=2, cursor="hand2", takefocus=False, borderwidth=1,
            highlightthickness=0,
        )
        self.button.pack(side="left", padx=(3, 0))

    def open(self):
        raise NotImplementedError


class DateField(PickerField):
    def __init__(self, master, textvariable, width=16):
        super().__init__(master, textvariable, "▾", width)

    def open(self):
        selected = parse_date_text(self.var.get()) or date.today()
        CalendarPopover(self, selected, lambda day: self.var.set(f"{day:{DATE_FORMAT}}"))


class TimeField(PickerField):
    def __init__(self, master, textvariable, width=8):
        super().__init__(master, textvariable, "▾", width)

    def open(self):
        hour, minute = parse_time_text(self.var.get()) or (datetime.now().hour, 0)
        TimePopover(self, hour, minute, lambda h, m: self.var.set(f"{h:02d}:{m:02d}"))


# --------------------------------------------------------------------------
# the window
# --------------------------------------------------------------------------


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "rotation"


def default_dir() -> str:
    desktop = Path.home() / "Desktop"
    return str(desktop if desktop.is_dir() else Path.home())


class PadelApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.history = load_history()
        self.results: queue.Queue = queue.Queue()
        self.name_vars: list[tk.StringVar] = []
        self.name_rows: list[tuple[ttk.Label, AutocompleteEntry]] = []
        self.busy = False
        self.scale = 1.0  # replaced with the real screen scaling in _build

        last = self.history.get("last", {})
        remembered = [n for n in last.get("players", []) if isinstance(n, str)]
        roster = remembered or list(padel.DEFAULT_PLAYERS)

        self.location = tk.StringVar(value=last.get("location", ""))
        self.date_text = tk.StringVar(value=last.get("date_text") or f"{datetime.now():%a %d %b}")
        self.title_text = tk.StringVar(value=last.get("title", "Padel Rotation"))
        self.start_text = tk.StringVar(value=last.get("start", "08:00"))
        self.minutes = tk.StringVar(value=str(last.get("minutes", 90)))
        self.courts = tk.StringVar(value=str(last.get("courts", 1)))
        self.n_players = tk.StringVar(value=str(len(roster)))
        self.auto_rounds = tk.BooleanVar(value=True)
        self.rounds = tk.StringVar(value="6")
        self.seed_text = tk.StringVar(value="")
        self.summary = tk.StringVar(value="")
        self.warning = tk.StringVar(value="")
        self.status = tk.StringVar(value="")

        self._build(roster)

        for var in (
            self.courts, self.n_players, self.minutes, self.start_text,
            self.rounds, self.location,
        ):
            var.trace_add("write", self._on_change)
        self.auto_rounds.trace_add("write", self._on_change)
        self._on_change()

    # -- layout -----------------------------------------------------------

    def _build(self, roster: list[str]):
        root = self.root
        root.title("Padel Rotation Scheduler")
        root.configure(bg=PAPER)
        apply_icon(root)
        # everything ttk draws scales with the screen; our own pixel sizes have
        # to follow suit or the window runs off the bottom of a high-dpi display
        self.scale = max(1.0, root.winfo_fpixels("1i") / 96.0)
        root.minsize(int(660 * self.scale), int(520 * self.scale))

        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("TLabel", background=PAPER, foreground=INK)
        style.configure("Muted.TLabel", background=PAPER, foreground=MUTED)
        style.configure("Warn.TLabel", background=PAPER, foreground=DANGER)
        style.configure("TFrame", background=PAPER)
        style.configure("TLabelframe", background=PAPER)
        style.configure("TLabelframe.Label", background=PAPER, foreground=MUTED)
        style.configure("TCheckbutton", background=PAPER)

        header = tk.Frame(root, bg=DEEP)
        header.pack(fill="x")
        tk.Label(
            header,
            text="Padel Rotation Scheduler",
            bg=DEEP,
            fg="white",
            font=("Segoe UI", 15, "bold"),
        ).pack(anchor="w", padx=18, pady=(14, 0))
        tk.Label(
            header,
            text="Equal court time, staggered rests, one PDF for the group chat",
            bg=DEEP,
            fg="#C3D8D2",
            font=("Segoe UI", 9),
        ).pack(anchor="w", padx=18, pady=(2, 14))

        body = ttk.Frame(root, padding=(18, 14))
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)

        # -- where and when
        details = ttk.Labelframe(body, text=" Where and when ", padding=(12, 10))
        details.grid(row=0, column=0, sticky="ew")
        for col in (1, 3, 5):
            details.columnconfigure(col, weight=1)

        ttk.Label(details, text="Location").grid(row=0, column=0, sticky="w", pady=4)
        AutocompleteEntry(
            details, lambda: self.history["locations"], textvariable=self.location, width=46
        ).grid(row=0, column=1, columnspan=5, sticky="ew", padx=(8, 0), pady=4)

        ttk.Label(details, text="Date").grid(row=1, column=0, sticky="w", pady=4)
        DateField(details, self.date_text).grid(
            row=1, column=1, sticky="ew", padx=(8, 14), pady=4
        )
        ttk.Label(details, text="Heading").grid(row=1, column=2, sticky="w", pady=4)
        ttk.Entry(details, textvariable=self.title_text).grid(
            row=1, column=3, columnspan=3, sticky="ew", padx=(8, 0), pady=4
        )

        ttk.Label(details, text="Start").grid(row=2, column=0, sticky="w", pady=4)
        TimeField(details, self.start_text).grid(
            row=2, column=1, sticky="w", padx=(8, 14), pady=4
        )
        ttk.Label(details, text="Minutes").grid(row=2, column=2, sticky="w", pady=4)
        ttk.Spinbox(
            details, from_=15, to=300, increment=15, textvariable=self.minutes, width=8
        ).grid(row=2, column=3, sticky="w", padx=(8, 14), pady=4)
        ttk.Label(details, text="Rounds").grid(row=2, column=4, sticky="w", pady=4)
        rounds_box = ttk.Frame(details)
        rounds_box.grid(row=2, column=5, sticky="w", padx=(8, 0), pady=4)
        ttk.Checkbutton(rounds_box, text="auto", variable=self.auto_rounds).pack(side="left")
        self.rounds_spin = ttk.Spinbox(
            rounds_box, from_=1, to=40, textvariable=self.rounds, width=6
        )
        self.rounds_spin.pack(side="left", padx=(6, 0))

        ttk.Label(details, text="Courts").grid(row=3, column=0, sticky="w", pady=4)
        ttk.Spinbox(
            details, from_=1, to=padel.MAX_COURTS, textvariable=self.courts, width=8
        ).grid(row=3, column=1, sticky="w", padx=(8, 14), pady=4)
        ttk.Label(details, text="Players").grid(row=3, column=2, sticky="w", pady=4)
        ttk.Spinbox(
            details, from_=4, to=padel.MAX_PLAYERS, textvariable=self.n_players, width=8
        ).grid(row=3, column=3, sticky="w", padx=(8, 14), pady=4)
        ttk.Label(details, text="Seed").grid(row=3, column=4, sticky="w", pady=4)
        ttk.Entry(details, textvariable=self.seed_text, width=12).grid(
            row=3, column=5, sticky="w", padx=(8, 0), pady=4
        )

        # -- players
        people = ttk.Labelframe(body, text=" Players ", padding=(12, 10))
        people.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        body.rowconfigure(1, weight=1)
        people.columnconfigure(0, weight=1)
        people.rowconfigure(0, weight=1)

        self.names_canvas = canvas = tk.Canvas(people, bg=PAPER, highlightthickness=0, height=140)
        canvas.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(people, orient="vertical", command=canvas.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        canvas.configure(yscrollcommand=scroll.set)

        self.names_frame = ttk.Frame(canvas)
        window = canvas.create_window((0, 0), window=self.names_frame, anchor="nw")
        self.names_frame.bind(
            "<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(window, width=e.width))
        canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(-e.delta // 120, "units"))
        for col in (1, 3):
            self.names_frame.columnconfigure(col, weight=1)

        self._set_name_count(len(roster), roster)

        # -- summary, warning, action
        ttk.Label(body, textvariable=self.summary, style="Muted.TLabel").grid(
            row=2, column=0, sticky="w", pady=(12, 0)
        )
        ttk.Label(body, textvariable=self.warning, style="Warn.TLabel", wraplength=560).grid(
            row=3, column=0, sticky="w", pady=(4, 0)
        )

        actions = ttk.Frame(body)
        actions.grid(row=4, column=0, sticky="ew", pady=(10, 0))
        actions.columnconfigure(0, weight=1)
        ttk.Label(actions, textvariable=self.status, style="Muted.TLabel", wraplength=420).grid(
            row=0, column=0, sticky="w"
        )
        self.generate_button = tk.Button(
            actions,
            text="Generate PDF",
            command=self.generate,
            bg=DEEP,
            fg="white",
            activebackground="#12564C",
            activeforeground="white",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=18,
            pady=8,
            cursor="hand2",
        )
        self.generate_button.grid(row=0, column=1, sticky="e")

        root.bind("<Return>", lambda _e: self.generate())

        # never open taller than the screen, or Generate ends up out of reach
        root.update_idletasks()
        height = min(root.winfo_reqheight(), root.winfo_screenheight() - int(90 * self.scale))
        width = max(root.winfo_reqwidth(), int(660 * self.scale))
        x = max(0, (root.winfo_screenwidth() - width) // 2)
        root.geometry(f"{width}x{height}+{x}+{int(30 * self.scale)}")

    def _set_name_count(self, count: int, preset: list[str] | None = None):
        """Add or remove name fields, keeping whatever is already typed."""
        preset = preset or []
        while len(self.name_vars) < count:
            index = len(self.name_vars)
            var = tk.StringVar(value=preset[index] if index < len(preset) else "")
            var.trace_add("write", self._on_change)
            label = ttk.Label(self.names_frame, text=f"{index + 1}", style="Muted.TLabel", width=3)
            entry = AutocompleteEntry(
                self.names_frame, lambda: self.history["players"], textvariable=var
            )
            self.name_vars.append(var)
            self.name_rows.append((label, entry))

        while len(self.name_vars) > count:
            label, entry = self.name_rows.pop()
            label.destroy()
            entry.destroy()
            self.name_vars.pop()

        per_column = (count + 1) // 2 or 1
        for index, (label, entry) in enumerate(self.name_rows):
            row, col = index % per_column, index // per_column
            label.grid(row=row, column=col * 2, sticky="w", pady=3)
            entry.grid(row=row, column=col * 2 + 1, sticky="ew", padx=(4, 16), pady=3)

        # only give the roster as much room as it needs, up to a scrollable cap
        if getattr(self, "names_canvas", None) is not None:
            scale = self.scale
            wanted = per_column * 29 * scale + 6
            self.names_canvas.configure(height=int(min(250 * scale, max(70 * scale, wanted))))

    # -- validation -------------------------------------------------------

    def _int(self, var: tk.StringVar, low: int, high: int) -> int | None:
        try:
            value = int(str(var.get()).strip())
        except ValueError:
            return None
        return value if low <= value <= high else None

    def _collect(self):
        """Read the form. Returns (session_kwargs, error_message)."""
        courts = self._int(self.courts, 1, padel.MAX_COURTS)
        if courts is None:
            return None, f"Courts must be a number from 1 to {padel.MAX_COURTS}."

        wanted = self._int(self.n_players, 4, padel.MAX_PLAYERS)
        if wanted is None:
            return None, f"Players must be a number from 4 to {padel.MAX_PLAYERS}."
        if wanted != len(self.name_vars):
            self._set_name_count(wanted)

        minutes = self._int(self.minutes, 15, 300)
        if minutes is None:
            return None, "Minutes must be a number from 15 to 300."

        raw = [var.get() for var in self.name_vars]
        blanks = sum(1 for name in raw if not name.strip())
        names, dup_error = padel.clean_names(raw)
        if dup_error:
            return None, dup_error[0].upper() + dup_error[1:] + "."
        if blanks:
            word = "name" if blanks == 1 else "names"
            return None, f"Enter all {wanted} player names - {blanks} {word} still empty."

        roster_error = padel.check_roster(names, courts)
        if roster_error:
            return None, roster_error[0].upper() + roster_error[1:] + "."

        start = None
        raw_start = self.start_text.get().strip()
        if raw_start:
            try:
                start = padel.parse_start(raw_start)
            except Exception:  # noqa: BLE001 - argparse raises its own type
                return None, f"Cannot read the start time {raw_start!r} - try 8:00 or 7:30pm."

        if self.auto_rounds.get():
            n_rounds = padel.choose_rounds(minutes, len(names), courts)
        else:
            n_rounds = self._int(self.rounds, 1, 40)
            if n_rounds is None:
                return None, "Rounds must be a number from 1 to 40, or tick auto."

        seed = None
        raw_seed = self.seed_text.get().strip()
        if raw_seed:
            try:
                seed = int(raw_seed)
            except ValueError:
                return None, "Seed must be a whole number, or leave it blank for a new rotation."

        session = padel.Session(
            players=names,
            minutes=minutes,
            n_rounds=n_rounds,
            courts=courts,
            start=start,
            title=self.title_text.get().strip() or "Padel Rotation",
            date_text=self.date_text.get().strip(),
            location=self.location.get().strip(),
        )
        return (session, seed), None

    def _on_change(self, *_args):
        self.rounds_spin.configure(state="disabled" if self.auto_rounds.get() else "normal")

        collected, error = self._collect()
        if error:
            self.warning.set("⚠  " + error)
            self.summary.set("")
            self.generate_button.configure(state="disabled", bg="#9AA8A3")
            return

        session, _seed = collected
        self.warning.set("")
        self.generate_button.configure(state="normal", bg=DEEP)

        slots = session.slots
        total = session.n_rounds * slots
        base, extra = divmod(total, session.n_players)
        if extra == 0:
            fairness = f"everyone plays {base}"
        else:
            fairness = f"{extra} play {base + 1}, the rest play {base}"
        courts_text = "1 court" if session.courts == 1 else f"{session.courts} courts"
        length = session.round_minutes
        length_text = f"{length:.0f}" if abs(length - round(length)) < 0.05 else f"{length:.1f}"
        resting = session.n_players - slots
        rest_text = "nobody rests" if resting == 0 else f"{resting} resting each round"
        self.summary.set(
            f"{session.n_players} players  ·  {courts_text}  ·  "
            f"{session.n_rounds} rounds × {length_text} min  ·  {fairness}  ·  "
            f"{rest_text}"
        )

    # -- generating -------------------------------------------------------

    def generate(self):
        if self.busy:
            return
        collected, error = self._collect()
        if error:
            messagebox.showwarning("Check the details", error, parent=self.root)
            return
        session, seed = collected

        stamp = slugify(session.location or session.title)
        path = filedialog.asksaveasfilename(
            parent=self.root,
            title="Save the rotation",
            defaultextension=".pdf",
            filetypes=[("PDF", "*.pdf")],
            initialdir=default_dir(),
            initialfile=f"padel-{stamp}.pdf",
        )
        if not path:
            return

        self.busy = True
        self.generate_button.configure(state="disabled", text="Generating…", bg="#9AA8A3")
        self.status.set("Working out the fairest rotation…")

        worker = threading.Thread(
            target=self._work, args=(session, seed, path), daemon=True
        )
        worker.start()
        self.root.after(100, self._poll)

    def _work(self, session, seed, path):
        try:
            rounds, stats, used_seed = padel.generate(session, seed)
            pages = padel.render_pdf(path, session, rounds, stats, used_seed)
            self.results.put(("ok", session, used_seed, path, pages))
        except Exception as exc:  # noqa: BLE001 - anything here belongs in a dialog
            self.results.put(("error", exc))

    def _poll(self):
        try:
            result = self.results.get_nowait()
        except queue.Empty:
            self.root.after(100, self._poll)
            return

        self.busy = False
        self.generate_button.configure(text="Generate PDF")
        self._on_change()

        if result[0] == "error":
            self.status.set("")
            messagebox.showerror("Could not build the PDF", str(result[1]), parent=self.root)
            return

        _, session, used_seed, path, pages = result
        self._save_history(session)
        self.status.set(f"Saved {Path(path).name}  ·  {pages} pages  ·  seed {used_seed}")
        try:
            os.startfile(path)  # noqa: S606 - windows convenience
        except OSError:
            pass

    def _save_history(self, session: padel.Session):
        self.history["players"] = remember(self.history["players"], session.players)
        if session.location:
            self.history["locations"] = remember(self.history["locations"], [session.location])
        self.history["last"] = {
            "players": session.players,
            "location": session.location,
            "date_text": session.date_text,
            "title": session.title,
            "courts": session.courts,
            "minutes": session.minutes,
            "start": self.start_text.get().strip(),
        }
        save_history(self.history)


def main():
    try:  # crisper text on high-dpi Windows screens
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
        # our own taskbar identity, so running from source shows our icon and
        # not Python's
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("barcor.padel.rotation")
    except Exception:  # noqa: BLE001 - not windows, or an older one
        pass

    root = tk.Tk()
    PadelApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
