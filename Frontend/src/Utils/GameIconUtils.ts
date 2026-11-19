import type { GameListEntry, GameSetting } from '../Models/types';

export function getContentGameIcon(
  { game, igdbId }: { game: string | null; igdbId?: number },
  gameList: GameListEntry[],
  settings: GameSetting[],
  loadGameArtwork: boolean,
): string | null {
  const listed =
    (igdbId != null && gameList.find((entry) => entry.igdbId === igdbId)) ||
    gameList.find((entry) => entry.name === game);
  const setting = settings.find((entry) => entry.name === game);
  const icon = listed?.icon || setting?.icon;
  if (icon && loadGameArtwork) return `https://segra.tv/api/games/icon/${icon}`;
  return setting?.customIcon ? `data:image/png;base64,${setting.customIcon}` : null;
}
