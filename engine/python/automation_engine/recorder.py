"""Gravador de mouse e teclado (Fase 7, ADR 0016). Roda como PROCESSO SEPARADO (`--record`), nunca dentro do motor.

Privacidade (é um keylogger por construção): nada é gravado em arquivo; os eventos saem por stdout (JSON Lines) direto para o
Main, que os mantém só em memória até o usuário revisar. Em MODO SENHA (Ctrl+Alt+S) as teclas digitadas NÃO são enviadas
(só um aviso de que houve digitação sensível). Controles globais, que nunca são gravados: Ctrl+Alt+R = parar, Ctrl+Alt+P =
pausar/retomar, Ctrl+Alt+S = modo senha.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any, Callable, Optional

MODIFIER_ALIASES = {
    "ctrl": "ctrl", "ctrl_l": "ctrl", "ctrl_r": "ctrl",
    "alt": "alt", "alt_l": "alt", "alt_r": "alt", "alt_gr": "altgr",  # AltGr (ABNT2: "/" é AltGr+Q) NÃO é Alt: o Windows ainda injeta um Ctrl falso junto
    "shift": "shift", "shift_l": "shift", "shift_r": "shift",
    "cmd": "win", "cmd_l": "win", "cmd_r": "win", "win": "win",
}
MOD_ORDER = ("ctrl", "alt", "shift", "win")
NAMED = {"enter", "tab", "esc", "backspace", "delete", "up", "down", "left", "right", "home", "end", "page_up", "page_down", *(f"f{i}" for i in range(1, 25))}
NAME_FIX = {"page_up": "pageup", "page_down": "pagedown"}
CONTROL = {"r": "stop", "p": "pause", "s": "secret"}


class Processor:
    """Transforma eventos brutos de teclado/mouse em eventos normalizados. Puro: sem tela, sem threads (testável em qualquer SO)."""

    def __init__(self, now: Callable[[], float] = time.monotonic) -> None:
        self._now = now
        self._t0 = now()
        self.mods: set[str] = set()
        self.paused = False
        self.secret = False
        self._fixed: Optional[int] = None  # testes: o evento bruto traz o próprio tempo

    def ms(self) -> int:
        return self._fixed if self._fixed is not None else int((self._now() - self._t0) * 1000)

    def toggle_pause(self) -> dict[str, Any]:
        self.paused = not self.paused
        return {"t": "paused", "on": self.paused, "ms": self.ms()}

    def feed(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        self._fixed = raw["ms"] if isinstance(raw.get("ms"), int) else None
        kind = raw.get("k")
        if kind == "click":
            return self._click(raw)
        if kind in ("press", "release"):
            return self._key(kind == "press", str(raw.get("key", "")), str(raw.get("canon", "")))
        return []

    def _click(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        if self.paused or not raw.get("pressed", True) or raw.get("button") not in ("left", "right"):
            return []
        try:
            x, y = int(raw["x"]), int(raw["y"])
        except (KeyError, TypeError, ValueError):
            return []
        return [{"t": "click", "x": x, "y": y, "button": raw["button"], "ms": self.ms()}]

    def _key(self, pressed: bool, key: str, canon: str = "") -> list[dict[str, Any]]:
        """`key` = o que a tecla PRODUZ (ex.: "A", "!", "/", "enter"); `canon` = a tecla-base física (ex.: "a", "1"), usada só para atalhos."""
        if not key and not canon:
            return []
        mod = MODIFIER_ALIASES.get(key)
        if mod:
            (self.mods.add if pressed else self.mods.discard)(mod)
            return []
        if not pressed:
            return []
        produced = key if key and (len(key) == 1 and key.isprintable() or key.lower() in NAMED or key.lower() == "space") else ""
        base = (canon or (key if len(key) == 1 else key.lower())).lower()
        # AltGr: o Windows injeta Ctrl+Alt falsos junto. Com AltGr o que importa é o caractere PRODUZIDO ("/" no ABNT2), nunca um atalho.
        altgr = "altgr" in self.mods
        mods = self.mods - ({"ctrl", "alt"} if altgr else set())
        # controles globais (nunca gravados): precisam de Ctrl+Alt REAIS
        if {"ctrl", "alt"} <= mods and base in CONTROL:
            action = CONTROL[base]
            if action == "stop":
                return [{"t": "stop", "ms": self.ms()}]
            if action == "pause":
                return [self.toggle_pause()]
            self.secret = not self.secret
            return [{"t": "secret", "on": self.secret, "ms": self.ms()}]
        if self.paused:
            return []
        held = [m for m in MOD_ORDER if m in mods]
        name = key.lower() if len(key) > 1 else key
        if name in NAMED:
            return [{"t": "hotkey", "keys": [*(m for m in held if m != "shift"), *(["shift"] if "shift" in held else []), NAME_FIX.get(name, name)], "ms": self.ms()}]
        if {"ctrl", "alt", "win"} & mods:  # atalho (ctrl+s etc.): a tecla-base, não o caractere (com Ctrl o produzido é um código de controle)
            if len(base) == 1 and base.isprintable() and base != " ":
                return [{"t": "hotkey", "keys": [*held, base], "ms": self.ms()}]
            return []
        ch = " " if name == "space" else (produced if len(produced) == 1 else "")
        if not ch:
            return []
        return [{"t": "secret_key", "ms": self.ms()}] if self.secret else [{"t": "char", "char": ch, "ms": self.ms()}]


def _emit(out: Any, obj: dict[str, Any]) -> None:
    out.write(json.dumps(obj, ensure_ascii=False) + "\n")
    out.flush()


def _pynput_source(feed: Callable[[dict[str, Any]], None], stop: threading.Event) -> None:
    from pynput import keyboard, mouse  # type: ignore[import-not-found]

    kl: Any = None

    def produced(key: Any) -> str:
        """O que a tecla produz (com Shift/AltGr): "A", "!", "/"; ou o nome de uma tecla especial ("enter")."""
        char = getattr(key, "char", None)
        if char:
            return char
        return getattr(key, "name", "") or ""

    def canon(key: Any) -> str:
        """A tecla-base física ("a", "1"): é a única forma de ver a LETRA quando Ctrl está pressionado (o produzido vira código de controle)."""
        try:
            c = kl.canonical(key)
            ch = getattr(c, "char", None)
            return ch if ch and ch.isprintable() else ""
        except Exception:  # noqa: BLE001
            return ""

    def on(kind: str) -> Callable[[Any], None]:
        return lambda k: feed({"k": kind, "key": produced(k), "canon": canon(k)})

    kl = keyboard.Listener(on_press=on("press"), on_release=on("release"))
    ml = mouse.Listener(on_click=lambda x, y, b, pressed: feed({"k": "click", "x": x, "y": y, "button": getattr(b, "name", ""), "pressed": pressed}))
    kl.start()
    ml.start()
    stop.wait()
    kl.stop()
    ml.stop()


def main(stdin: Any = None, stdout: Any = None) -> int:
    stdin = stdin or sys.stdin
    out = stdout or sys.__stdout__
    fake = os.environ.get("AUTOMATION_RECORDER_FAKE") if os.environ.get("AUTOMATION_ENGINE_TEST_ACTIONS") == "1" else None
    proc = Processor()
    stop = threading.Event()
    lock = threading.Lock()

    def feed(raw: dict[str, Any]) -> None:
        with lock:
            for ev in proc.feed(raw):
                _emit(out, ev)
                if ev["t"] == "stop":
                    stop.set()

    def commands() -> None:  # o Main pode pedir pausa/parada pela interface
        for line in stdin:
            cmd = line.strip()
            with lock:
                if cmd == "stop":
                    _emit(out, {"t": "stop", "ms": proc.ms()})
                    stop.set()
                    return
                if cmd == "pause":
                    _emit(out, proc.toggle_pause())
        if not fake:
            stop.set()  # EOF: o Main morreu (no modo de teste o EOF não interrompe a reprodução)

    try:
        if not fake:
            import pynput  # noqa: F401  (falha cedo e com mensagem clara)
    except Exception as e:  # noqa: BLE001
        _emit(out, {"t": "error", "code": "DEPENDENCY_MISSING", "message": f"A biblioteca pynput não pôde ser carregada ({type(e).__name__}: {str(e)[:150]}). Instale no Python do motor ({sys.executable}) com: python -m pip install -r engine/python/requirements-recorder.txt"})
        return 1
    _emit(out, {"t": "ready"})
    threading.Thread(target=commands, daemon=True).start()
    if fake:
        with open(fake, encoding="utf-8") as f:  # teste: reproduz eventos brutos com o relógio do próprio arquivo
            for raw in json.load(f):
                if stop.is_set():
                    break
                feed(raw)
        stop.wait(timeout=0.2)  # dá tempo de um `stop` pendente chegar
    else:
        _pynput_source(feed, stop)
    _emit(out, {"t": "bye"})
    return 0
