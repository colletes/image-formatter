import { app, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';

// Desabilita avisos de segurança se estivermos carregando do localhost no dev
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Define tema escuro se o OS for escuro
  nativeTheme.themeSource = 'system';
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images & PDFs', extensions: ['jpg', 'png', 'jpeg', 'webp', 'pdf'] }
    ]
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  const filePath = filePaths[0];
  const isPDF = filePath.toLowerCase().endsWith('.pdf');
  
  if (isPDF) {
     // TODO: Implement PDF to Image conversion
     // We will return the first page as an image
     return { path: filePath, isPDF: true, previewPath: null };
  } else {
     // Read image as base64 for preview
     const bitmap = fs.readFileSync(filePath);
     const base64 = Buffer.from(bitmap).toString('base64');
     const ext = path.extname(filePath).substring(1);
     const dataUrl = `data:image/${ext};base64,${base64}`;
     return { path: filePath, isPDF: false, previewData: dataUrl };
  }
});

ipcMain.handle('image:crop', async (_, args) => {
  const { imagePath, crops } = args;
  try {
    const dir = path.dirname(imagePath);
    const basename = path.basename(imagePath, path.extname(imagePath));
    const outDir = path.join(dir, 'cropped');
    
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Invalid image metadata");

    const promises = crops.map(async (crop: any, index: number) => {
      // Crop expects relative percentages
      const left = Math.max(0, Math.round(crop.x * metadata.width!));
      const top = Math.max(0, Math.round(crop.y * metadata.height!));
      let width = Math.round(crop.width * metadata.width!);
      let height = Math.round(crop.height * metadata.height!);

      // Bounds checking
      if (left + width > metadata.width!) width = metadata.width! - left;
      if (top + height > metadata.height!) height = metadata.height! - top;
      if (width <= 0 || height <= 0) return null;

      const outPath = path.join(outDir, `${basename}_crop_${index + 1}.jpg`);
      await sharp(imagePath)
        .extract({ left, top, width, height })
        .toFile(outPath);
      
      return outPath;
    });

    const results = await Promise.all(promises);
    return { success: true, savedTo: results.filter(r => r !== null) };
  } catch (err: any) {
    console.error("Crop error:", err);
    return { success: false, error: err.message };
  }
});
