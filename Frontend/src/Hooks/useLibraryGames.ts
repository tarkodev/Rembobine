import { useMemo } from 'react';
import { gameFilterKey, IMPORTED, type GameOption } from '../Components/ContentFilters';
import { useAppState } from '../Context/AppStateContext';
import { useSettings } from '../Context/SettingsContext';
import { getContentGameIcon } from '../Utils/GameIconUtils';

export function useLibraryGames(
  items: { game: string | null; isImported: boolean; igdbId?: number }[],
) {
  const { gameList } = useAppState();
  const { games, loadGameArtwork } = useSettings();
  return useMemo(() => {
    const gamesByName = new Map<string, GameOption>();
    let importedCount = 0;
    for (const item of items) {
      if (item.isImported) importedCount++;
      const { game } = item;
      if (!game || (item.isImported && game === 'Unknown')) continue;
      const existing = gamesByName.get(game);
      if (existing) existing.count++;
      else
        gamesByName.set(game, {
          key: gameFilterKey(game),
          name: game,
          icon: getContentGameIcon(item, gameList, games, loadGameArtwork),
          count: 1,
        });
    }
    const gameOptions = [...gamesByName.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
    if (importedCount > 0)
      gameOptions.push({
        key: IMPORTED,
        name: gamesByName.has(IMPORTED) ? 'Imported files' : 'Imported',
        icon: null,
        count: importedCount,
      });
    return { gameOptions, gamesByName };
  }, [items, gameList, games, loadGameArtwork]);
}
