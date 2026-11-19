import type { Content, GameListEntry, GameSetting } from '../Models/types';

export function getContentGameIcon(
  { game, igdbId }: Pick<Content, 'game' | 'igdbId'>,
  gameList: GameListEntry[],
  settings: GameSetting[],
  airplaneMode: boolean,
): string | null {
  const listed =
    (igdbId != null && gameList.find((entry) => entry.igdbId === igdbId)) ||
    gameList.find((entry) => entry.name === game);
  const setting = settings.find((entry) => entry.name === game);
  const icon = listed?.icon || setting?.icon;
  if (icon && !airplaneMode) return `https://segra.tv/api/games/icon/${icon}`;
  return setting?.customIcon ? `data:image/png;base64,${setting.customIcon}` : null;
}
