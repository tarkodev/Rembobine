import { FileText, RefreshCw, BookOpen } from 'lucide-react';
import { GithubIcon, DiscordIcon } from '../icons/BrandIcons';
import DropdownSelect from '../DropdownSelect';
import { Settings as SettingsType } from '../../Models/types';
import { sendMessageToBackend } from '../../Utils/MessageUtils';
import Button from '../Button';
import { useAppState } from '../../Context/AppStateContext';

interface AdvancedSectionProps {
  settings: SettingsType;
  updateSettings: (updates: Partial<SettingsType>) => void;
  openReleaseNotesModal: (version: string | null) => void;
  checkForUpdates: () => void;
  // False on Linux (Flatpak): show update guidance instead of the in-app updater controls.
  canSelfUpdate: boolean;
}

const onlineFeatures = [
  {
    key: 'loadGameArtwork',
    label: 'Load game artwork',
    description: 'Download game icons and covers from segra.tv.',
  },
  {
    key: 'enableAccountAndSharing',
    label: 'Enable account and sharing',
    description:
      'Sign in to upload and share clips and highlights. Turning this off signs you out.',
  },
] as const;

export default function AdvancedSection({
  settings,
  updateSettings,
  openReleaseNotesModal,
  checkForUpdates,
  canSelfUpdate,
}: AdvancedSectionProps) {
  const appState = useAppState();

  return (
    <>
      <div className="p-4 bg-base-300 rounded-lg shadow-md border border-base-400">
        <h2 className="text-xl font-semibold mb-4">Updates</h2>
        {!canSelfUpdate && (
          <p className="text-sm opacity-70 mb-4">
            Rembobine updates automatically through Flatpak. To update now, run{' '}
            <code className="px-1 py-0.5 rounded bg-base-200">flatpak update tv.segra.Segra</code>{' '}
            or use your software center.
          </p>
        )}
        {/* OBS Version is hidden when the recorder is fixed for this install (bundled or already downloaded) */}
        {(canSelfUpdate || appState.availableOBSVersions.length > 0) && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {canSelfUpdate && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-base-content">Update Channel</span>
                </label>
                <DropdownSelect
                  items={[
                    { value: 'stable', label: 'Stable' },
                    { value: 'beta', label: 'Beta' },
                  ]}
                  value={settings.receiveBetaUpdates ? 'beta' : 'stable'}
                  onChange={(val) => updateSettings({ receiveBetaUpdates: val === 'beta' })}
                />
              </div>
            )}
            {appState.availableOBSVersions.length > 0 && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-base-content">OBS Version</span>
                </label>
                <DropdownSelect
                  items={[
                    { value: '', label: 'Automatic' },
                    ...[...appState.availableOBSVersions]
                      .sort((a, b) => {
                        return b.version.localeCompare(a.version, undefined, { numeric: true });
                      })
                      .map((v) => ({
                        value: v.version,
                        label: `${v.version}${v.isBeta ? ' (Beta)' : ''}`,
                      })),
                  ]}
                  value={settings.selectedOBSVersion || ''}
                  onChange={(val) => updateSettings({ selectedOBSVersion: val || null })}
                />
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {canSelfUpdate && (
            <Button
              variant="primary"
              size="sm"
              className="gap-2 bg-base-200 hover:bg-base-300"
              onClick={() => checkForUpdates()}
              loading={appState.isCheckingForUpdates}
            >
              {!appState.isCheckingForUpdates && <RefreshCw size={16} className="shrink-0" />}
              <span className="inline-block">Check for Updates</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            className="gap-2 bg-base-200 hover:bg-base-300"
            onClick={() => openReleaseNotesModal(null)}
          >
            <GithubIcon size={16} aria-hidden="true" />
            <span className="inline-block">View Release Notes</span>
          </Button>
        </div>
      </div>

      <div className="p-4 bg-base-300 rounded-lg shadow-md border border-base-400">
        <h2 className="text-xl font-semibold mb-4">Online Features</h2>
        <div className="space-y-2">
          {onlineFeatures.map(({ key, label, description }) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer p-3 bg-base-200 rounded-lg border border-base-400"
            >
              <input
                type="checkbox"
                name={key}
                checked={settings[key]}
                onChange={(e) => updateSettings({ [key]: e.target.checked })}
                className="checkbox checkbox-primary checkbox-sm"
              />
              <div>
                <span className="font-semibold">{label}</span>
                <div className="text-sm opacity-70 mt-0.5">{description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Version */}
      <div className="text-center mt-4 text-sm text-base-content/60">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                sendMessageToBackend('OpenInBrowser', { Url: 'https://docs.segra.tv' })
              }
            >
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="leading-none">Docs</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                sendMessageToBackend('OpenInBrowser', { Url: 'https://discord.gg/6JbPTS9weF' })
              }
            >
              <DiscordIcon size={16} className="shrink-0" aria-hidden="true" />
              <span className="leading-none">Discord</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => sendMessageToBackend('OpenLogsLocation')}
            >
              <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="leading-none">Logs</span>
            </Button>
          </div>
          <div>
            Rembobine{' '}
            {__APP_VERSION__ === 'Developer Preview' ? __APP_VERSION__ : 'v' + __APP_VERSION__}
          </div>
        </div>
      </div>
    </>
  );
}
