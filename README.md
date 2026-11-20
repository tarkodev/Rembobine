# Segrabi

An unofficial fork of [Segra](https://github.com/Segergren/Segra)
focused on gameplay screenshots and more control over recording and playback.

## Roadmap

- [ ] Add a **Trash** view for manually deleted videos and screenshots. Restore an item to its original
  library with its title and bookmarks, including links from source sessions. Empty the trash to free disk space.
- [ ] Add **Albums** so users can group videos and screenshots into named collections.
- [ ] Add **Favorites** so users can mark videos and screenshots as favorites and browse them together.
- [ ] Track videos and screenshots renamed or moved within the library in File Explorer. Preserve custom titles,
  bookmarks, and links to and from Full Sessions.
- [ ] Automatically update the library when videos or screenshots are added or deleted in File Explorer,
  including when several files change at once.
- [ ] Refresh thumbnails when a video or screenshot is edited in place by another app. Update the displayed
  duration when a video is trimmed.
- [x] Reuse the open File Explorer window for **Open Folder** and **Open File Location** on Windows.
  Opening a file location selects the requested file in its folder.
- [x] Add `Segrabi.exe --quit` on Windows for local updates. It requests the same shutdown as **Quit Segrabi**
  in the system tray and waits for the app to exit. It also succeeds if Segrabi is already closed.
- [x] Add **📷 Screenshots** below **Highlights** and a configurable **Take Screenshot** hotkey. It saves a PNG
  from the active game recording or replay buffer. Assign a key under **Settings → Hotkeys**.
- [x] Add **Save Frame as Screenshot** to the paused video player. Both capture methods save to the same gallery
  and play a shutter sound at the configured **Sound Effects Volume**.
- [x] Add image import, game filters, sorting, and a dedicated screenshot viewer with navigation, zoom, and fullscreen.
- [x] Add **Show Import in Clips and Highlights** under **Settings → Preferences → Interface**. It is off by default.
  When enabled, the **Import** button on each page adds MP4 files to that library.
- [x] Rename the replay library to **Replay Buffers** in the sidebar, page heading, and menu customization.
- [x] Add **Replay Saved** and **Screenshot Saved** bookmarks to the current **Full Session** after each successful
  save. The bookmark menu opens the media, and **Back** returns to the same playback position in the session.
- [x] Add **Open Full Session** next to **Copy** in the replay player and screenshot viewer. It opens the session
  at the saved replay or screenshot bookmark. **Back** returns to the replay or screenshot. The button is disabled
  when there is no linked session in the library.
- [x] Add a **Clip Saved** bookmark at the end of each exported segment. **Open Clip** plays that
  excerpt from its start in the finished clip. In the clip player, **Open Full Session** opens the source session
  for the current excerpt when a link is available.
- [x] Add **Recording Start Sound** under **Settings → Preferences → App**, below **Sound Effects Volume**.
  **Off** mutes the start beep. **Manual Only** (default) plays it when you start a recording yourself.
  **Manual & Automatic** also plays it when Segrabi starts a recording automatically. Saving a replay
  plays its own confirmation at the configured **Sound Effects Volume**.
- [x] Add **Recording Stop Sound** next to **Recording Start Sound** with **Off**, **Manual Only** (default),
  and **Manual & Automatic**.
- [x] Add **Enable Recording Preview** and **Disable Recording Preview** to the **⋯** menu on the active
  recording card. The menu shows the action for the current preview state.
- [x] Disable double-click fullscreen in the clip player. Keep the fullscreen button.
- [x] Add **Exclude Replay Buffer From Storage Limit** under **Settings → Storage**, above
  **Exclude Clips and Highlights From Storage Limit**. It is on by default. While on, saved replays
  are excluded from the storage quota and the cleanup it triggers. With a quota set, **Storage Usage** shows their size
  as **not counted**.

  > Replay Buffers are kept when freeing up space. When on, their size is excluded from the limit.

Build Segrabi from source using the setup instructions in [CONTRIBUTING.md](CONTRIBUTING.md).

## Upstream Segra

The overview, downloads, and code signing information below describe the original Segra project.

<img height="100" src="https://cdn.segra.tv/icon.png"/>

**Segra** is an open-source game recorder built on Open Broadcaster Software (OBS). It records your games in the background, lets you clip the good parts with a hotkey, and uploads them to [Segra.tv](https://segra.tv).

### Clip Editor

![image](https://github.com/user-attachments/assets/beed0524-35f1-48be-9dd8-c2455959d2f9)

### Highlights

![image](https://github.com/user-attachments/assets/481cc9fa-3efb-412d-b668-8be7d11b9851)


### Settings

![image](https://github.com/user-attachments/assets/de300431-1b63-4ed2-a022-110f8f828d1a)


---

## Features  
- Auto-starts recording when a game launches
- Replay buffer, save the last moments with a hotkey
- Up to 4K 144 FPS, HDR on Windows
- H.264, HEVC and AV1 (NVENC, AMD AMF, Intel QSV or x264)
- Multiple audio devices, separate audio tracks, mic noise suppression
- Clip editor with timeline and audio waveform
- Auto highlights from kill/death tracking in CS2, League, Dota 2, PUBG, Rocket League, Rust, Minecraft, RuneScape: Dragonwilds, War Thunder and GTA
- Upload to **[Segra.tv](https://segra.tv)**
- Per-game overrides for quality, recording mode, HDR and volume
- Storage limit auto-deletes old recordings

---

## Why "Segra"?  
**Segra** (pronounced *"say-grah"*) means **"to win"** in Swedish. We built Segra to help you preserve those moments: the chaotic fun with friends, the clutch plays, and the wins (*segra!*) that deserve their own highlight reel.  

---

## Installation

### Windows
1. **Download**: Get `Segra-win-Setup.exe` from the [latest release](https://github.com/Segergren/Segra/releases/latest).  
2. **Install**: Run the setup.  
3. **Configure**:  
   - Set recording directory and video quality.  
   - Assign hotkeys for clipping/uploading.  
   - Connect your Segra.tv account.  

### Linux (Alpha)
Linux support is in early alpha. It might not start at all, and features that work on Windows can be missing or broken. Please do not open GitHub issues for Linux problems yet.

1. Download `Segra.flatpak` from the [latest release](https://github.com/Segergren/Segra/releases/latest).
2. Install it with `flatpak install Segra.flatpak`.

## Uninstallation

### Windows
1. Open `Windows Settings`
2. Go to `Apps` -> `Installed apps`
3. Search for `Segra`
4. Click `Uninstall`

### Linux
Run `flatpak uninstall tv.segra.Segra`.

## Contributing  
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, dependencies, and dev workflow.
Help improve Segra by:  
- Report bugs or suggest features  
- Submit pull requests

---

## License  
Segra is **GPLv2 licensed**.  

---

## Code Signing Policy
<table>
  <tr>
    <td><a href="https://signpath.org/" target="_blank"><img src="https://avatars.githubusercontent.com/u/34448643" height="30" alt="SignPath logo" /></a></td>
    <td>free code signing on Windows provided by <a href="https://signpath.io/" target="_blank">SignPath.io</a>, certificate by <a href="https://signpath.org/" target="_blank">SignPath Foundation</a></td>
  </tr>
</table>


**Team roles**

| Role      | Person |
|-----------|--------|
| Authors   | @Segergren |
| Reviewers | @Segergren |
| Approvers | @Segergren |

See our [Privacy Policy](https://segra.tv/privacy).

## Star History

<a href="https://www.star-history.com/?type=date&repos=Segergren%2FSegra">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Segergren/Segra&type=date&theme=dark&legend=top-left&sealed_token=JAaIsTwnipw7yKMwYTxXAZTVKOfmPUNhuDq2_b7iPCO4-K-c1tnLij-MXN0o8ZbyGH-ydukOtzcwUcsqXaiT89vKt6uwbFN8sKxKTRX9DGRLb1PPfRBgE7Wk8RrqLcQINaezbgie3IQEx-RMzNP98N3s2eQLQJgAXde2kUEHsgzPYk_DNdNIy58gfLsE" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Segergren/Segra&type=date&legend=top-left&sealed_token=JAaIsTwnipw7yKMwYTxXAZTVKOfmPUNhuDq2_b7iPCO4-K-c1tnLij-MXN0o8ZbyGH-ydukOtzcwUcsqXaiT89vKt6uwbFN8sKxKTRX9DGRLb1PPfRBgE7Wk8RrqLcQINaezbgie3IQEx-RMzNP98N3s2eQLQJgAXde2kUEHsgzPYk_DNdNIy58gfLsE" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Segergren/Segra&type=date&legend=top-left&sealed_token=JAaIsTwnipw7yKMwYTxXAZTVKOfmPUNhuDq2_b7iPCO4-K-c1tnLij-MXN0o8ZbyGH-ydukOtzcwUcsqXaiT89vKt6uwbFN8sKxKTRX9DGRLb1PPfRBgE7Wk8RrqLcQINaezbgie3IQEx-RMzNP98N3s2eQLQJgAXde2kUEHsgzPYk_DNdNIy58gfLsE" />
 </picture>
</a>


## Acknowledgments
- **[OBS Studio](https://obsproject.com)**: Segra records through OBS (libobs).
- **[ObsKit.NET](https://github.com/Segergren/ObsKit.NET)**: C# bindings for libobs, written for Segra.
- **[FFmpeg](https://github.com/FFmpeg/FFmpeg)**: for video and image encoding.  
