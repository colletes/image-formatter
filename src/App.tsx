import React, { useState, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';

// Typings for Electron API
declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ path: string, isPDF: boolean, previewData?: string, previewPath?: string } | null>;
      cropImage: (args: { imagePath: string, crops: { x: number, y: number, width: number, height: number }[] }) => Promise<{ success: boolean, savedTo?: string[], error?: string }>;
    }
  }
}

type Tool = 'select' | 'rect' | 'line';
type CropRect = { id: string, x: number, y: number, width: number, height: number };

const App: React.FC = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [rects, setRects] = useState<CropRect[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<Partial<CropRect> | null>(null);
  
  const stageRef = useRef<any>(null);

  const handleOpenFile = async () => {
    const result = await window.electronAPI.openFile();
    if (result && result.previewData) {
      setImagePath(result.path);
      const img = new window.Image();
      img.src = result.previewData;
      img.onload = () => {
        setImage(img);
        setRects([]); // reset rects on new image
      };
    }
  };

  const handleMouseDown = (e: any) => {
    if (tool !== 'rect') return;
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawing(true);
    setNewRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || tool !== 'rect' || !newRect) return;
    const pos = e.target.getStage().getPointerPosition();
    setNewRect({
      ...newRect,
      width: pos.x - newRect.x!,
      height: pos.y - newRect.y!
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || tool !== 'rect' || !newRect) return;
    setIsDrawing(false);
    if (Math.abs(newRect.width!) > 5 && Math.abs(newRect.height!) > 5) {
      setRects([...rects, {
        id: Date.now().toString(),
        x: newRect.width! < 0 ? newRect.x! + newRect.width! : newRect.x!,
        y: newRect.height! < 0 ? newRect.y! + newRect.height! : newRect.y!,
        width: Math.abs(newRect.width!),
        height: Math.abs(newRect.height!)
      }]);
    }
    setNewRect(null);
  };

  const autoSuggest = () => {
    if (!image) return;
    // Simple 3x3 grid suggestion as requested (placeholder for more advanced CV)
    const margin = 20;
    const cw = (image.width - margin * 4) / 3;
    const ch = (image.height - margin * 4) / 3;
    
    const suggested: CropRect[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        suggested.push({
          id: `auto_${row}_${col}`,
          x: margin + col * (cw + margin),
          y: margin + row * (ch + margin),
          width: cw,
          height: ch
        });
      }
    }
    setRects(suggested);
  };

  const saveMasks = () => {
    const data = JSON.stringify(rects);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'masks.json';
    a.click();
  };

  const handleCrop = async () => {
    if (!imagePath || rects.length === 0) return;
    
    // Calculate relative percentages
    const scaleX = image!.width;
    const scaleY = image!.height;
    
    const crops = rects.map(r => ({
      x: r.x / scaleX,
      y: r.y / scaleY,
      width: r.width / scaleX,
      height: r.height / scaleY
    }));

    const result = await window.electronAPI.cropImage({ imagePath, crops });
    if (result.success) {
      alert(`Recortes salvos com sucesso!\n\n${result.savedTo?.join('\n')}`);
    } else {
      alert(`Erro ao salvar: ${result.error}`);
    }
  };

  return (
    <div className="app-container">
      <div className="toolbar">
        <h2>Image Formatter</h2>
        
        <button onClick={handleOpenFile}>Abrir Arquivo</button>
        
        <div className="tools-group">
          <h3>Ferramentas</h3>
          <button className={`tool-btn ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')}>Selecionar</button>
          <button className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => setTool('rect')}>Desenhar Máscara</button>
        </div>

        <div className="tools-group">
          <h3>Ações</h3>
          <button className="tool-btn" onClick={autoSuggest}>Auto Sugerir (3x3)</button>
          <button className="tool-btn" onClick={saveMasks}>Salvar Máscara</button>
          <button onClick={handleCrop} style={{ backgroundColor: '#28a745' }}>Recortar e Salvar</button>
        </div>
      </div>
      
      <div className="canvas-container">
        {image ? (
          <Stage 
            width={image.width} 
            height={image.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            ref={stageRef}
          >
            <Layer>
              <KonvaImage image={image} />
              {rects.map((rect, i) => (
                <Rect
                  key={rect.id}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="rgba(0, 255, 0, 0.2)"
                  stroke="green"
                  strokeWidth={2}
                  draggable={tool === 'select'}
                  onDragEnd={(e) => {
                    const newRects = rects.slice();
                    newRects[i] = { ...rect, x: e.target.x(), y: e.target.y() };
                    setRects(newRects);
                  }}
                />
              ))}
              {newRect && (
                <Rect
                  x={newRect.x}
                  y={newRect.y}
                  width={newRect.width}
                  height={newRect.height}
                  fill="rgba(0, 255, 0, 0.2)"
                  stroke="green"
                  strokeWidth={2}
                />
              )}
            </Layer>
          </Stage>
        ) : (
          <p>Selecione uma imagem ou PDF para começar.</p>
        )}
      </div>
    </div>
  );
};

export default App;
