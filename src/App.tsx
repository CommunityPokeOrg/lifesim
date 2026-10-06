import { useMemo, useState } from "react";
import { BUILTIN_PACKS } from "./packs";
import type { EventPack } from "./engine/types";
import GameScreen from "./game/GameScreen";
import EditorScreen from "./editor/EditorScreen";

/**
 * Packs shipped with the app; each can be toggled on/off in the game UI.
 * Sourced from src/packs/*.json via import.meta.glob, so a new bundled
 * pack file needs no code changes here.
 */
const BUNDLED_PACKS: EventPack[] = BUILTIN_PACKS;

export default function App() {
  const [screen, setScreen] = useState<"play" | "editor">("play");
  const [enabledIds, setEnabledIds] = useState<string[]>(
    BUNDLED_PACKS.map((p) => p.id),
  );
  const [imported, setImported] = useState<EventPack[]>([]);

  const addPack = (pack: EventPack) =>
    setImported((prev) => {
      const rest = prev.filter((p) => p.id !== pack.id);
      return [...rest, pack];
    });

  const togglePack = (id: string) =>
    setEnabledIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const packs = useMemo(
    () => [
      ...BUNDLED_PACKS.filter((p) => enabledIds.includes(p.id)),
      ...imported.filter(
        (p) => !BUNDLED_PACKS.some((b) => b.id === p.id),
      ),
    ],
    [enabledIds, imported],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">lifesim</span>
        <nav>
          <button
            className={screen === "play" ? "tab active" : "tab"}
            onClick={() => setScreen("play")}
          >
            Play
          </button>
          <button
            className={screen === "editor" ? "tab active" : "tab"}
            onClick={() => setScreen("editor")}
          >
            Mod Editor
          </button>
        </nav>
        <span className="packs-hint">
          {packs.length} pack{packs.length === 1 ? "" : "s"} loaded
        </span>
      </header>
      {screen === "play" ? (
        <GameScreen
          packs={packs}
          bundledPacks={BUNDLED_PACKS}
          enabledPackIds={enabledIds}
          onTogglePack={togglePack}
          onImportPack={addPack}
        />
      ) : (
        <EditorScreen onPlaytest={(pack) => { addPack(pack); setScreen("play"); }} />
      )}
    </div>
  );
}
