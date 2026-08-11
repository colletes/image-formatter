import { app, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';

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
     return { path: filePath, isPDF: true, previewPath: null };
  } else {
     const bitmap = fs.readFileSync(filePath);
     const base64 = Buffer.from(bitmap).toString('base64');
     const ext = path.extname(filePath).substring(1);
     const dataUrl = `data:image/${ext};base64,${base64}`;
     return { path: filePath, isPDF: false, previewData: dataUrl };
  }
});

ipcMain.handle('image:crop', async (_, args) => {
  const { imagePath, crops, exportSVG } = args;
  try {
    const dir = path.dirname(imagePath);
    const basename = path.basename(imagePath, path.extname(imagePath));
    const outDir = path.join(dir, 'cropped');
    
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Invalid image metadata");

    const mw = metadata.width;
    const mh = metadata.height;

    const promises = crops.map(async (crop: any, index: number) => {
      if (crop.type === 'rect') {
        let left = Math.max(0, Math.round(crop.x * mw));
        let top = Math.max(0, Math.round(crop.y * mh));
        let width = Math.round(crop.width * mw);
        let height = Math.round(crop.height * mh);

        if (left + width > mw) width = mw - left;
        if (top + height > mh) height = mh - top;
        if (width <= 0 || height <= 0) return null;

        const outPath = path.join(outDir, `${basename}_crop_${index + 1}.jpg`);
        await sharp(imagePath)
          .extract({ left, top, width, height })
          .toFile(outPath);
        
        return outPath;
      } else {
        // Polygon or freehand
        const points = crop.points;
        if (!points || points.length < 3) return null;

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of points) {
          const absX = pt.x * mw;
          const absY = pt.y * mh;
          if (absX < minX) minX = absX;
          if (absY < minY) minY = absY;
          if (absX > maxX) maxX = absX;
          if (absY > maxY) maxY = absY;
        }

        let left = Math.max(0, Math.floor(minX));
        let top = Math.max(0, Math.floor(minY));
        let width = Math.ceil(maxX - minX);
        let height = Math.ceil(maxY - minY);

        if (left + width > mw) width = mw - left;
        if (top + height > mh) height = mh - top;
        if (width <= 0 || height <= 0) return null;

        // Build SVG path relative to the extracted bounding box
        let pathData = '';
        points.forEach((pt: any, i: number) => {
          const x = (pt.x * mw) - left;
          const y = (pt.y * mh) - top;
          pathData += `${i === 0 ? 'M' : 'L'} ${x} ${y} `;
        });
        pathData += 'Z';

        const svgBuffer = Buffer.from(
          `<svg width="${width}" height="${height}"><path d="${pathData}" fill="black" /></svg>`
        );

        const outPath = path.join(outDir, `${basename}_crop_${index + 1}.png`);
        await sharp(imagePath)
          .extract({ left, top, width, height })
          .composite([{ input: svgBuffer, blend: 'dest-in' }])
          .png()
          .toFile(outPath);
        
        // Export SVG if requested
        if (exportSVG) {
          const svgOutPath = path.join(outDir, `${basename}_crop_${index + 1}.svg`);
          fs.writeFileSync(svgOutPath, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${pathData}" fill="none" stroke="red" stroke-width="1"/></svg>`);
        }

        return outPath;
      }
    });

    const results = await Promise.all(promises);
    return { success: true, savedTo: results.filter(r => r !== null) };
  } catch (err: any) {
    console.error("Crop error:", err);
    return { success: false, error: err.message };
  }
});
