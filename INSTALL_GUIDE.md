# Beginner's Guide: Building VR Launch Manager

This guide is designed for users who are new to software development. Follow these steps to build the application from scratch on your own Windows computer.

## Step 1: Install Necessary Tools

Before we begin, you need to install **Node.js**. This is the engine that runs the code building tools.

1.  Go to the official website: [https://nodejs.org/](https://nodejs.org/)
2.  Download the **LTS (Long Term Support)** version (recommended for most users).
3.  Run the installer. Keep clicking "Next" and accept the defaults until it's finished.

## Step 2: Download the Source Code

1.  Go to the GitHub page for this project.
2.  Click the green **<> Code** button.
3.  Select **Download ZIP**.
4.  Once downloaded, extract (unzip) the folder to a convenient location, like your Desktop.

## Step 3: Open a Terminal

1.  Open the folder you just extracted (it should be named `VR-Launch-Manager-main` or similar).
2.  **Right-click** on any empty white space inside that folder.
3.  Select **Open in Terminal** (or "Open PowerShell window here").
    *   *Note: If you don't see this option, hold the SHIFT key on your keyboard, then Right-Click.*

## Step 4: Install Dependencies

In the black/blue terminal window that appeared, type the following command and press **Enter**:

```powershell
npm install
```

*   You will see a lot of text scrolling by. This is normal.
*   Wait until it stops and you can type again. This might take 1-2 minutes.

## Step 5: Build the App

Now, type this command and press **Enter**:

```powershell
npm run build
```

*   This process compiles the code into a working Windows application.
*   It may take a minute or two.
*   When it says "Done" or stops nicely without big red errors, you are ready!

## Step 6: Locate Your App

1.  Go back to the folder in File Explorer.
2.  You will see a new folder named `release`. Open it.
3.  Inside, you may see a version folder (like `1.0.0`) or a `win-unpacked` folder.
4.  Look for **`VR Launch Manager.exe`** (it might just say "VR Launch Manager" with the logo).
5.  Double-click it to run your new launcher!

---

**Tip**: You can Right-Click the `.exe` file and choose "Send to -> Desktop (create shortcut)" to make it easier to open later.
