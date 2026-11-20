# Rembobine

After each user-requested change, verify it, commit the files for that change, and push the commit to the current branch on `origin`.

Prefer the terminal and automated tests for Rembobine work. Ask the user before using Computer Use on their desktop.

For local updates on Windows, you may quit Rembobine normally during a recording. With a version that supports
`--quit`, run the installed executable with `Start-Process -FilePath $exe -ArgumentList '--quit' -Wait -PassThru`
and check its `ExitCode` before replacing files. A nonzero result means the exit could not be confirmed.
For older versions, use **Quit Rembobine** in the system tray. Never force-stop the recorder to install an update.
