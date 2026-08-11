import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Group, Circle } from 'react-konva';
import Konva from 'konva';

// Typings for Electron API
declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ path: string, isPDF: boolean, previewData?: string, previewPath?: string } | null>;
      cropImage: (args: { imagePath: string, crops: any[], exportSVG: boolean }) => Promise<{ success: boolean, savedTo?: string[], error?: string }>;
    }
  }
}

type Tool = 'select' | 'rect' | 'polygon' | 'freehand';

interface BaseShape {
  id: string;
  type: 'rect' | 'polygon' | 'freehand';
}
interface RectShape extends BaseShape {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PolyShape extends BaseShape {
  type: 'polygon' | 'freehand';
  points: number[];
  x?: number; // For dragging
  y?: number;
}
type Shape = RectShape | PolyShape;

const App: React.FC = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  
  // History State
  const [past, setPast] = useState<Shape[][]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportSVG, setExportSVG] = useState(false);

  // Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<Partial<RectShape> | null>(null);
  const [newPoly, setNewPoly] = useState<number[]>([]);
  
  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageRef = useRef<Konva.Stage>(null);

  // Helper to commit changes to history
  const commit = useCallback((newShapes: Shape[]) => {
    setPast((prev) => [...prev, shapes]);
    setShapes(newShapes);
    setFuture([]);
  }, [shapes]);

  const undo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([shapes, ...future]);
    setShapes(previous);
    setSelectedId(null);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, shapes]);
    setShapes(next);
    setSelectedId(null);
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(shapes.filter(s => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, shapes, commit]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        deleteSelected();
      }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, deleteSelected, past, future, shapes]);

  const handleOpenFile = async () => {
    const result = await window.electronAPI.openFile();
    if (result && result.previewData) {
      setImagePath(result.path);
      const img = new window.Image();
      img.src = result.previewData;
      img.onload = () => {
        setImage(img);
        setShapes([]);
        setPast([]);
        setFuture([]);
        setScale(1);
        setStagePos({ x: 0, y: 0 });
      };
    }
  };

  const getPointerPos = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    return {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: (pos.y - stage.y()) / stage.scaleY(),
    };
  };

  const handleMouseDown = (e: any) => {
    // If clicking on a shape, let its onClick handle it, unless we are drawing
    if (tool === 'select') {
      const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'backgroundImage';
      if (clickedOnEmpty) setSelectedId(null);
      return;
    }

    const pos = getPointerPos(e);

    if (tool === 'rect') {
      setIsDrawing(true);
      setNewRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'freehand') {
      setIsDrawing(true);
      setNewPoly([pos.x, pos.y]);
    } else if (tool === 'polygon') {
      if (newPoly.length === 0) {
        setNewPoly([pos.x, pos.y]);
      } else {
        // Check if clicked near start point to close
        const startX = newPoly[0];
        const startY = newPoly[1];
        const dist = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
        if (dist < 15 / scale && newPoly.length > 4) {
          // Close polygon
          commit([...shapes, { id: Date.now().toString(), type: 'polygon', points: newPoly }]);
          setNewPoly([]);
        } else {
          setNewPoly([...newPoly, pos.x, pos.y]);
        }
      }
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing && tool !== 'polygon') return;
    const pos = getPointerPos(e);

    if (tool === 'rect' && isDrawing && newRect) {
      setNewRect({
        ...newRect,
        width: pos.x - newRect.x!,
        height: pos.y - newRect.y!
      });
    } else if (tool === 'freehand' && isDrawing) {
      setNewPoly([...newPoly, pos.x, pos.y]);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (tool === 'rect' && newRect) {
      if (Math.abs(newRect.width!) > 5 && Math.abs(newRect.height!) > 5) {
        commit([...shapes, {
          id: Date.now().toString(),
          type: 'rect',
          x: newRect.width! < 0 ? newRect.x! + newRect.width! : newRect.x!,
          y: newRect.height! < 0 ? newRect.y! + newRect.height! : newRect.y!,
          width: Math.abs(newRect.width!),
          height: Math.abs(newRect.height!)
        }]);
      }
      setNewRect(null);
    } else if (tool === 'freehand' && newPoly.length > 4) {
      commit([...shapes, { id: Date.now().toString(), type: 'freehand', points: newPoly }]);
      setNewPoly([]);
    }
  };

  // Zoom logic
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    
    const scaleBy = 1.1;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const autoSuggest = () => {
    if (!image) return;
    const margin = 20;
    const cw = (image.width - margin * 4) / 3;
    const ch = (image.height - margin * 4) / 3;
    
    const suggested: Shape[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        suggested.push({
          id: `auto_${row}_${col}_${Date.now()}`,
          type: 'rect',
          x: margin + col * (cw + margin),
          y: margin + row * (ch + margin),
          width: cw,
          height: ch
        });
      }
    }
    commit([...shapes, ...suggested]);
  };

  const handleCrop = async () => {
    if (!imagePath || shapes.length === 0) return;
    
    const scaleX = image!.width;
    const scaleY = image!.height;
    
    // Convert shapes to relative coordinates so backend doesn't lose resolution
    const crops = shapes.map(s => {
      if (s.type === 'rect') {
        const rs = s as RectShape;
        return { type: 'rect', x: rs.x / scaleX, y: rs.y / scaleY, width: rs.width / scaleX, height: rs.height / scaleY };
      } else {
        const ps = s as PolyShape;
        // Adjust points by node translation if it was moved
        const xOffset = ps.x || 0;
        const yOffset = ps.y || 0;
        const pts = [];
        for (let i = 0; i < ps.points.length; i += 2) {
          pts.push({ x: (ps.points[i] + xOffset) / scaleX, y: (ps.points[i+1] + yOffset) / scaleY });
        }
        return { type: ps.type, points: pts };
      }
    });

    const result = await window.electronAPI.cropImage({ imagePath, crops, exportSVG });
    if (result.success) {
      alert(`Arquivos salvos com sucesso!\n\n${result.savedTo?.join('\n')}`);
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
          <button className={`tool-btn ${tool === 'select' ? 'active' : ''}`} onClick={() => { setTool('select'); setNewPoly([]); }}>Selecionar / Pan</button>
          <button className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => { setTool('rect'); setNewPoly([]); setSelectedId(null); }}>Retângulo</button>
          <button className={`tool-btn ${tool === 'polygon' ? 'active' : ''}`} onClick={() => { setTool('polygon'); setNewPoly([]); setSelectedId(null); }}>Polígono (Pontos)</button>
          <button className={`tool-btn ${tool === 'freehand' ? 'active' : ''}`} onClick={() => { setTool('freehand'); setNewPoly([]); setSelectedId(null); }}>Desenho Livre</button>
        </div>

        <div className="tools-group">
          <h3>Ações da Máscara</h3>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="tool-btn" style={{ flex: 1 }} onClick={undo} disabled={past.length === 0}>Desfazer</button>
            <button className="tool-btn" style={{ flex: 1 }} onClick={redo} disabled={future.length === 0}>Refazer</button>
          </div>
          <button className="tool-btn" onClick={deleteSelected} disabled={!selectedId} style={{ borderColor: selectedId ? 'red' : '' }}>Apagar Selecionada</button>
          <button className="tool-btn" onClick={autoSuggest}>Auto Sugerir (Grade 3x3)</button>
        </div>

        <div className="tools-group" style={{ marginTop: 'auto' }}>
          <h3>Exportar</h3>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={exportSVG} onChange={e => setExportSVG(e.target.checked)} />
            Exportar SVG (Vetores de Corte)
          </label>
          <button onClick={handleCrop} style={{ backgroundColor: '#28a745' }}>Recortar e Salvar</button>
        </div>
      </div>
      
      <div className="canvas-container">
        {image ? (
          <Stage 
            width={window.innerWidth - 250} 
            height={window.innerHeight}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            scaleX={scale}
            scaleY={scale}
            x={stagePos.x}
            y={stagePos.y}
            draggable={tool === 'select'}
            ref={stageRef}
          >
            <Layer>
              <KonvaImage image={image} name="backgroundImage" />
              
              {/* Existing Shapes */}
              {shapes.map((shape) => {
                const isSelected = shape.id === selectedId;
                const strokeColor = isSelected ? 'red' : 'green';
                const fillColor = isSelected ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.2)';

                if (shape.type === 'rect') {
                  const r = shape as RectShape;
                  return (
                    <Rect
                      key={r.id}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={2 / scale}
                      draggable={tool === 'select'}
                      onClick={() => tool === 'select' && setSelectedId(r.id)}
                      onDragEnd={(e) => {
                        const newShapes = shapes.map(s => s.id === r.id ? { ...r, x: e.target.x(), y: e.target.y() } : s);
                        commit(newShapes);
                      }}
                    />
                  );
                } else {
                  const p = shape as PolyShape;
                  return (
                    <Line
                      key={p.id}
                      points={p.points}
                      x={p.x || 0}
                      y={p.y || 0}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={2 / scale}
                      closed={true}
                      tension={p.type === 'freehand' ? 0.5 : 0}
                      draggable={tool === 'select'}
                      onClick={() => tool === 'select' && setSelectedId(p.id)}
                      onDragEnd={(e) => {
                        const newShapes = shapes.map(s => s.id === p.id ? { ...p, x: e.target.x(), y: e.target.y() } : s);
                        commit(newShapes);
                      }}
                    />
                  );
                }
              })}
              
              {/* Drawing Previews */}
              {newRect && (
                <Rect
                  x={newRect.x}
                  y={newRect.y}
                  width={newRect.width}
                  height={newRect.height}
                  fill="rgba(0, 255, 0, 0.2)"
                  stroke="green"
                  strokeWidth={2 / scale}
                />
              )}
              {newPoly.length > 0 && (
                <Group>
                  <Line
                    points={newPoly}
                    stroke="green"
                    strokeWidth={2 / scale}
                    tension={tool === 'freehand' ? 0.5 : 0}
                    closed={false}
                  />
                  {/* Show closing hint for polygon */}
                  {tool === 'polygon' && newPoly.length >= 2 && (
                    <Circle x={newPoly[0]} y={newPoly[1]} radius={5 / scale} fill="yellow" stroke="black" strokeWidth={1/scale} />
                  )}
                </Group>
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
