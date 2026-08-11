"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const sharp_1 = __importDefault(require("sharp"));
// Desabilita avisos de segurança se estivermos carregando do localhost no dev
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    // Define tema escuro se o OS for escuro
    electron_1.nativeTheme.themeSource = 'system';
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// --- IPC Handlers ---
electron_1.ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
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
    }
    else {
        // Read image as base64 for preview
        const bitmap = fs.readFileSync(filePath);
        const base64 = Buffer.from(bitmap).toString('base64');
        const ext = path.extname(filePath).substring(1);
        const dataUrl = `data:image/${ext};base64,${base64}`;
        return { path: filePath, isPDF: false, previewData: dataUrl };
    }
});
electron_1.ipcMain.handle('image:crop', async (_, args) => {
    const { imagePath, crops } = args;
    try {
        const dir = path.dirname(imagePath);
        const basename = path.basename(imagePath, path.extname(imagePath));
        const outDir = path.join(dir, 'cropped');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const metadata = await (0, sharp_1.default)(imagePath).metadata();
        if (!metadata.width || !metadata.height)
            throw new Error("Invalid image metadata");
        const promises = crops.map(async (crop, index) => {
            // Crop expects relative percentages
            const left = Math.max(0, Math.round(crop.x * metadata.width));
            const top = Math.max(0, Math.round(crop.y * metadata.height));
            let width = Math.round(crop.width * metadata.width);
            let height = Math.round(crop.height * metadata.height);
            // Bounds checking
            if (left + width > metadata.width)
                width = metadata.width - left;
            if (top + height > metadata.height)
                height = metadata.height - top;
            if (width <= 0 || height <= 0)
                return null;
            const outPath = path.join(outDir, `${basename}_crop_${index + 1}.jpg`);
            await (0, sharp_1.default)(imagePath)
                .extract({ left, top, width, height })
                .toFile(outPath);
            return outPath;
        });
        const results = await Promise.all(promises);
        return { success: true, savedTo: results.filter(r => r !== null) };
    }
    catch (err) {
        console.error("Crop error:", err);
        return { success: false, error: err.message };
    }
});
