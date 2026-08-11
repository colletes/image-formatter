import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Group, Circle, Transformer } from 'react-konva';
import Konva from 'konva';
import { getMagicWandPolygon } from './utils/cv';

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ path: string, isPDF: boolean, previewData?: string, previewPath?: string } | null>;
      cropImage: (args: { imagePath: string, crops: any[], exportSVG: boolean, fileNamePrefix?: string }) => Promise<{ success: boolean, savedTo?: string[], error?: string }>;
    }
  }
}

type Tool = 'select' | 'rect' | 'polygon' | 'freehand' | 'magicwand';

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
  x?: number;
  y?: number;
}
type Shape = RectShape | PolyShape;

const App: React.FC = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  
  const [past, setPast] = useState<Shape[][]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Shape | null>(null);
  const [exportSVG, setExportSVG] = useState(false);
  const [fileNamePrefix, setFileNamePrefix] = useState('');
  const [tolerance, setTolerance] = useState(30);

  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<Partial<RectShape> | null>(null);
  const [newPoly, setNewPoly] = useState<number[]>([]);
  
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (selectedId && trRef.current && stageRef.current) {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer()?.batchDraw();
      }
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [selectedId, shapes]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Evita ações se estiver digitando em um input
      if (document.activeElement?.tagName === 'INPUT') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        deleteSelected();
      }
      if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key.toLowerCase() === 'c' && (e.metaKey || e.ctrlKey) && selectedId) {
        const shapeToCopy = shapes.find(s => s.id === selectedId);
        if (shapeToCopy) setClipboard(shapeToCopy);
      }
      if (e.key.toLowerCase() === 'v' && (e.metaKey || e.ctrlKey) && clipboard) {
        const newShape = JSON.parse(JSON.stringify(clipboard));
        newShape.id = Date.now().toString() + Math.random();
        
        if (newShape.type === 'rect') {
          newShape.x += 20 / scale;
          newShape.y += 20 / scale;
        } else {
          newShape.x = (newShape.x || 0) + 20 / scale;
          newShape.y = (newShape.y || 0) + 20 / scale;
        }
        
        commit([...shapes, newShape]);
        setSelectedId(newShape.id);
        setTool('select');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, deleteSelected, past, future, shapes, clipboard, commit, scale]);

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
        
        // Caching ImageData for Magic Wand
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          setImageData(ctx.getImageData(0, 0, img.width, img.height));
        }
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
    if (tool === 'select') {
      const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'backgroundImage';
      if (clickedOnEmpty) setSelectedId(null);
      return;
    }

    const pos = getPointerPos(e);

    if (tool === 'magicwand') {
      if (!imageData) return;
      const polyPoints = getMagicWandPolygon(imageData, pos.x, pos.y, tolerance, 2.0);
      if (polyPoints.length > 4) {
        commit([...shapes, { id: Date.now().toString(), type: 'polygon', points: polyPoints }]);
      }
      return;
    }

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
        const startX = newPoly[0];
        const startY = newPoly[1];
        const dist = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
        if (dist < 15 / scale && newPoly.length > 4) {
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
    
    const crops = shapes.map(s => {
      if (s.type === 'rect') {
        const rs = s as RectShape;
        return { type: 'rect', x: rs.x / scaleX, y: rs.y / scaleY, width: rs.width / scaleX, height: rs.height / scaleY };
      } else {
        const ps = s as PolyShape;
        const xOffset = ps.x || 0;
        const yOffset = ps.y || 0;
        const pts = [];
        for (let i = 0; i < ps.points.length; i += 2) {
          pts.push({ x: (ps.points[i] + xOffset) / scaleX, y: (ps.points[i+1] + yOffset) / scaleY });
        }
        return { type: ps.type, points: pts };
      }
    });

    const result = await window.electronAPI.cropImage({ imagePath, crops, exportSVG, fileNamePrefix });
    if (result.success) {
      alert(`Arquivos salvos com sucesso!\n\n${result.savedTo?.join('\n')}`);
    } else {
      alert(`Erro ao salvar: ${result.error}`);
    }
  };

  return (
    <div className="app-container">
      <div className="toolbar" style={{ overflowY: 'auto' }}>
        <h2>Image Formatter</h2>
        
        <button onClick={handleOpenFile}>Abrir Arquivo</button>
        
        <div className="tools-group">
          <h3>Ferramentas</h3>
          <button className={`tool-btn ${tool === 'select' ? 'active' : ''}`} onClick={() => { setTool('select'); setNewPoly([]); }}>Selecionar / Pan</button>
          
          <button className={`tool-btn ${tool === 'magicwand' ? 'active' : ''}`} onClick={() => { setTool('magicwand'); setNewPoly([]); setSelectedId(null); }} style={{ borderColor: tool === 'magicwand' ? '#ff00ff' : '', backgroundColor: tool === 'magicwand' ? 'rgba(255,0,255,0.1)' : '' }}>🪄 Varinha Mágica</button>
          {tool === 'magicwand' && (
            <div style={{ fontSize: 12, padding: '5px 0' }}>
              <label>Tolerância de Cor: {tolerance}</label>
              <input type="range" min="0" max="100" value={tolerance} onChange={e => setTolerance(parseInt(e.target.value))} style={{ width: '100%' }} />
            </div>
          )}

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
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: '5px' }}>Nome Base dos Arquivos:</label>
            <input 
              type="text" 
              value={fileNamePrefix} 
              onChange={e => setFileNamePrefix(e.target.value)} 
              placeholder="Ex: carta_monstro"
              style={{ width: '100%', padding: '5px', boxSizing: 'border-box', background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid #ccc', borderRadius: '4px' }}
            />
          </div>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={exportSVG} onChange={e => setExportSVG(e.target.checked)} />
            Exportar SVG (Vetores)
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
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
            onDragStart={(e) => {
              if (tool === 'select' && e.target === e.target.getStage()) {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = 'grabbing';
              }
            }}
            onDragEnd={(e) => {
              if (tool === 'select' && e.target === e.target.getStage()) {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = 'default';
              }
            }}
          >
            <Layer>
              <KonvaImage image={image} name="backgroundImage" />
              
              {shapes.map((shape) => {
                const isSelected = shape.id === selectedId;
                const strokeColor = isSelected ? 'red' : (shape.type === 'polygon' || shape.type === 'freehand' ? 'cyan' : 'green');
                const fillColor = isSelected ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)';

                if (shape.type === 'rect') {
                  const r = shape as RectShape;
                  return (
                    <Rect
                      key={r.id}
                      id={r.id}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      fill={isSelected ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.2)'}
                      stroke={isSelected ? 'red' : 'green'}
                      strokeWidth={2 / scale}
                      draggable={tool === 'select'}
                      onClick={() => tool === 'select' && setSelectedId(r.id)}
                      onMouseEnter={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grab';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'default';
                        }
                      }}
                      onDragStart={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grabbing';
                        }
                      }}
                      onDragEnd={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grab';
                          const newShapes = shapes.map(s => s.id === r.id ? { ...r, x: e.target.x(), y: e.target.y() } : s);
                          commit(newShapes);
                        }
                      }}
                      onTransformEnd={(e) => {
                        const node = e.target;
                        const scaleX = node.scaleX();
                        const scaleY = node.scaleY();
                        node.scaleX(1);
                        node.scaleY(1);
                        const newShapes = shapes.map(s => {
                          if (s.id === r.id) {
                            return {
                              ...r,
                              x: node.x(),
                              y: node.y(),
                              width: Math.max(5, r.width * scaleX),
                              height: Math.max(5, r.height * scaleY),
                            };
                          }
                          return s;
                        });
                        commit(newShapes);
                      }}
                    />
                  );
                } else {
                  const p = shape as PolyShape;
                  return (
                    <Line
                      key={p.id}
                      id={p.id}
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
                      onMouseEnter={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grab';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'default';
                        }
                      }}
                      onDragStart={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grabbing';
                        }
                      }}
                      onDragEnd={(e) => {
                        if (tool === 'select') {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'grab';
                          const newShapes = shapes.map(s => s.id === p.id ? { ...p, x: e.target.x(), y: e.target.y() } : s);
                          commit(newShapes);
                        }
                      }}
                      onTransformEnd={(e) => {
                        const node = e.target;
                        const scaleX = node.scaleX();
                        const scaleY = node.scaleY();
                        node.scaleX(1);
                        node.scaleY(1);
                        const newShapes = shapes.map(s => {
                          if (s.id === p.id) {
                            const newPoints = p.points.map((pt, i) => i % 2 === 0 ? pt * scaleX : pt * scaleY);
                            return { ...p, points: newPoints, x: node.x(), y: node.y() };
                          }
                          return s;
                        });
                        commit(newShapes);
                      }}
                    />
                  );
                }
              })}
              
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
                    stroke="cyan"
                    strokeWidth={2 / scale}
                    tension={tool === 'freehand' ? 0.5 : 0}
                    closed={false}
                  />
                  {tool === 'polygon' && newPoly.length >= 2 && (
                    <Circle x={newPoly[0]} y={newPoly[1]} radius={5 / scale} fill="yellow" stroke="black" strokeWidth={1/scale} />
                  )}
                </Group>
              )}

              {selectedId && (
                <Transformer
                  ref={trRef}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 5 || newBox.height < 5) return oldBox;
                    return newBox;
                  }}
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
