import { useMemo, useState } from "react";
import { loadBundledPacks } from "./packs/index";
import { effectivePack, flattenPack } from "./engine/packs";
import type { EventPack, LoadedPack } from "./engine/types";
import GameScreen from "./game/GameScreen";
import EditorScreen from "./editor/EditorScreen";

/**
 * Packs shipped with the app, loaded once at startup. Nested packs
 * (src/packs/<dir>/pack.json + section files) are resolved and validated by
 * the loader; each pack and each section can be toggled in the game UI.
 */
const BUNDLED_PACKS: LoadedPack[] = loadBundledPacks();

export default function App() {
  const [screen, setScreen] = useState<"play" | "editor">("play");
  const [enabledIds, setEnabledIds] = useState<string[]>(
    BUNDLED_PACKS.map((p) => p.pack.id),
  );
  const [disabledSections, setDisabledSections] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [imported, setImported] = useState<LoadedPack[]>([]);

  const addPack = (pack: LoadedPack) =>
    setImported((prev) => {
      const rest = prev.filter((p) => p.pack.id !== pack.pack.id);
      return [...rest, pack];
    });

  const togglePack = (id: string) =>
    setEnabledIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const toggleSection = (key: string) =>
    setDisabledSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const packs = useMemo<EventPack[]>(
    () => [
      ...BUNDLED_PACKS.filter((p) => enabledIds.includes(p.pack.id)),
      ...imported.filter(
        (p) => !BUNDLED_PACKS.some((b) => b.pack.id === p.pack.id),
      ),
    ].map((p) => effectivePack(p, disabledSections)),
    [enabledIds, disabledSections, imported],
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
          disabledSections={disabledSections}
          onToggleSection={toggleSection}
          onImportPack={addPack}
        />
      ) : (
        <EditorScreen
          onPlaytest={(pack) => {
            addPack(flattenPack(pack));
            setScreen("play");
          }}
        />
      )}
    </div>
  );
}
