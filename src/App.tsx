import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Group, Circle, Transformer } from 'react-konva';
import Konva from 'konva';
import { getMagicWandPolygon } from './utils/cv';

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ path: string, isPDF: boolean, previewData?: string, previewPath?: string } | null>;
      cropImage: (args: { imagePath: string, crops: any[], exportSVG: boolean, fileNamePrefix?: string }) => Promise<{ success: boolean, savedTo?: string[], error?: string }>;
      saveMask: (shapes: Shape[]) => Promise<{ success: boolean, error?: string }>;
      loadMask: () => Promise<{ success: boolean, shapes?: Shape[], error?: string }>;
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
export type Shape = RectShape | PolyShape;

const App: React.FC = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  
  const [past, setPast] = useState<Shape[][]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  
  const [tool, setTool] = useState<Tool>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<Shape[]>([]);
  
  const [exportSVG, setExportSVG] = useState(false);
  const [fileNamePrefix, setFileNamePrefix] = useState('');
  const [tolerance, setTolerance] = useState(30);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);

  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<Partial<RectShape> | null>(null);
  const [newPoly, setNewPoly] = useState<number[]>([]);
  
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (selectedIds.length > 0 && trRef.current && stageRef.current) {
      const nodes = selectedIds.map(id => stageRef.current?.findOne('#' + id)).filter(Boolean) as Konva.Node[];
      trRef.current.nodes(nodes);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [selectedIds, shapes]);

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
    setSelectedIds([]);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, shapes]);
    setShapes(next);
    setSelectedIds([]);
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    commit(shapes.filter(s => !selectedIds.includes(s.id)));
    setSelectedIds([]);
  }, [selectedIds, shapes, commit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        deleteSelected();
      }
      if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key.toLowerCase() === 'c' && (e.metaKey || e.ctrlKey) && selectedIds.length > 0) {
        const shapesToCopy = shapes.filter(s => selectedIds.includes(s.id));
        setClipboard(shapesToCopy);
      }
      if (e.key.toLowerCase() === 'v' && (e.metaKey || e.ctrlKey) && clipboard.length > 0) {
        const newShapesGroup = clipboard.map(c => {
          const newShape = JSON.parse(JSON.stringify(c));
          newShape.id = Date.now().toString() + Math.random();
          if (newShape.type === 'rect') {
            newShape.x += 20 / scale;
            newShape.y += 20 / scale;
          } else {
            newShape.x = (newShape.x || 0) + 20 / scale;
            newShape.y = (newShape.y || 0) + 20 / scale;
          }
          return newShape;
        });
        
        commit([...shapes, ...newShapesGroup]);
        setSelectedIds(newShapesGroup.map(s => s.id));
        setTool('select');
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 / scale : 1 / scale;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        
        const newShapes = shapes.map(s => {
          if (selectedIds.includes(s.id)) {
            if (s.type === 'rect') {
              const rs = s as RectShape;
              return { ...rs, x: rs.x + dx, y: rs.y + dy };
            } else {
              const ps = s as PolyShape;
              return { ...ps, x: (ps.x || 0) + dx, y: (ps.y || 0) + dy };
            }
          }
          return s;
        });
        commit(newShapes);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteSelected, past, future, shapes, clipboard, commit, scale]);

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
      if (clickedOnEmpty) setSelectedIds([]);
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

  const handleShapeClick = (id: string, e: any) => {
    if (tool !== 'select') return;
    if (e.evt.shiftKey) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter(s => s !== id));
      } else {
        setSelectedIds([...selectedIds, id]);
      }
    } else {
      setSelectedIds([id]);
    }
  };

  const getShapeGuides = (s: Shape) => {
    const x = s.x || 0;
    const y = s.y || 0;
    let w = 0, h = 0;
    if (s.type === 'rect') {
      w = (s as RectShape).width;
      h = (s as RectShape).height;
    }
    return {
      v: [x, x + w/2, x + w],
      h: [y, y + h/2, y + h]
    };
  };

  const handleDragMove = (e: any, shapeId: string) => {
    if (tool !== 'select' || !isSnapEnabled || selectedIds.length > 1) return;
    const node = e.target;
    
    // Snapping logic
    const x = node.x();
    const y = node.y();
    const w = (node.width() || 0) * node.scaleX();
    const h = (node.height() || 0) * node.scaleY();
    
    const myV = [x, x + w/2, x + w];
    const myH = [y, y + h/2, y + h];
    
    const snapDist = 10 / scale;
    let minDx = Infinity, minDy = Infinity;

    shapes.forEach(s => {
      if (s.id === shapeId) return;
      const target = getShapeGuides(s);
      
      myV.forEach(mv => {
        target.v.forEach(tv => {
          if (Math.abs(tv - mv) < Math.abs(minDx)) minDx = tv - mv;
        });
      });
      
      myH.forEach(mh => {
        target.h.forEach(th => {
          if (Math.abs(th - mh) < Math.abs(minDy)) minDy = th - mh;
        });
      });
    });

    if (Math.abs(minDx) < snapDist) node.x(x + minDx);
    if (Math.abs(minDy) < snapDist) node.y(y + minDy);
  };

  const alignSelected = (alignment: string) => {
    if (selectedIds.length < 2) return;
    
    const selectedShapes = shapes.filter(s => selectedIds.includes(s.id));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedShapes.forEach(s => {
       const x = s.x || 0;
       const y = s.y || 0;
       const w = s.type === 'rect' ? (s as RectShape).width : 0;
       const h = s.type === 'rect' ? (s as RectShape).height : 0;
       if (x < minX) minX = x;
       if (y < minY) minY = y;
       if (x+w > maxX) maxX = x+w;
       if (y+h > maxY) maxY = y+h;
    });
  
    const newShapes = shapes.map(s => {
      if (!selectedIds.includes(s.id)) return s;
      const ns = { ...s };
      const w = ns.type === 'rect' ? (ns as RectShape).width : 0;
      const h = ns.type === 'rect' ? (ns as RectShape).height : 0;
  
      if (alignment === 'left') ns.x = minX;
      if (alignment === 'right') ns.x = maxX - w;
      if (alignment === 'top') ns.y = minY;
      if (alignment === 'bottom') ns.y = maxY - h;
      if (alignment === 'centerH') ns.x = minX + (maxX - minX)/2 - w/2;
      if (alignment === 'centerV') ns.y = minY + (maxY - minY)/2 - h/2;
      return ns;
    });

    if (alignment === 'distH' && selectedIds.length > 2) {
      const sorted = [...selectedShapes].sort((a,b) => (a.x||0) - (b.x||0));
      const first = sorted[0];
      const last = sorted[sorted.length-1];
      const span = (last.x||0) - (first.x||0);
      const step = span / (sorted.length - 1);
      sorted.forEach((ss, idx) => {
         const ns = newShapes.find(x => x.id === ss.id);
         if (ns) ns.x = (first.x||0) + step * idx;
      });
    }
    
    if (alignment === 'distV' && selectedIds.length > 2) {
      const sorted = [...selectedShapes].sort((a,b) => (a.y||0) - (b.y||0));
      const first = sorted[0];
      const last = sorted[sorted.length-1];
      const span = (last.y||0) - (first.y||0);
      const step = span / (sorted.length - 1);
      sorted.forEach((ss, idx) => {
         const ns = newShapes.find(x => x.id === ss.id);
         if (ns) ns.y = (first.y||0) + step * idx;
      });
    }
  
    commit(newShapes);
  };

  const autoSuggest = () => {
    if (!image) return;
    const margin = 20;
    const cw = (image.width - margin * 4) / 3;
    const ch = (image.height - margin * 4) / 3;
    const suggested: Shape[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        suggested.push({ id: `auto_${row}_${col}_${Date.now()}`, type: 'rect', x: margin + col * (cw + margin), y: margin + row * (ch + margin), width: cw, height: ch });
      }
    }
    commit([...shapes, ...suggested]);
  };

  const handleSavePreset = async () => {
    if (shapes.length === 0) return;
    const result = await window.electronAPI.saveMask(shapes);
    if (result.error) alert(`Erro ao salvar: ${result.error}`);
  };

  const handleLoadPreset = async () => {
    const result = await window.electronAPI.loadMask();
    if (result.success && result.shapes) commit(result.shapes);
    else if (result.error) alert(`Erro ao carregar: ${result.error}`);
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
    if (result.success) alert(`Arquivos salvos com sucesso!\n\n${result.savedTo?.join('\n')}`);
    else alert(`Erro ao salvar: ${result.error}`);
  };

  return (
    <div className="app-container">
      <div className="toolbar" style={{ overflowY: 'auto' }}>
        <h2>Image Formatter</h2>
        
        <button onClick={handleOpenFile}>Abrir Arquivo</button>
        
        <div className="tools-group">
          <h3>Ferramentas</h3>
          <button className={`tool-btn ${tool === 'select' ? 'active' : ''}`} onClick={() => { setTool('select'); setNewPoly([]); }}>Selecionar / Pan</button>
          
          <button className={`tool-btn ${tool === 'magicwand' ? 'active' : ''}`} onClick={() => { setTool('magicwand'); setNewPoly([]); setSelectedIds([]); }} style={{ borderColor: tool === 'magicwand' ? '#ff00ff' : '', backgroundColor: tool === 'magicwand' ? 'rgba(255,0,255,0.1)' : '' }}>🪄 Varinha Mágica</button>
          {tool === 'magicwand' && (
            <div style={{ fontSize: 12, padding: '5px 0' }}>
              <label>Tolerância de Cor: {tolerance}</label>
              <input type="range" min="0" max="100" value={tolerance} onChange={e => setTolerance(parseInt(e.target.value))} style={{ width: '100%' }} />
            </div>
          )}

          <button className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => { setTool('rect'); setNewPoly([]); setSelectedIds([]); }}>Retângulo</button>
          <button className={`tool-btn ${tool === 'polygon' ? 'active' : ''}`} onClick={() => { setTool('polygon'); setNewPoly([]); setSelectedIds([]); }}>Polígono (Pontos)</button>
          <button className={`tool-btn ${tool === 'freehand' ? 'active' : ''}`} onClick={() => { setTool('freehand'); setNewPoly([]); setSelectedIds([]); }}>Desenho Livre</button>
        </div>

        <div className="tools-group">
          <h3>Ações e Layout</h3>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="tool-btn" style={{ flex: 1 }} onClick={undo} disabled={past.length === 0}>Desfazer</button>
            <button className="tool-btn" style={{ flex: 1 }} onClick={redo} disabled={future.length === 0}>Refazer</button>
          </div>
          <button className="tool-btn" onClick={deleteSelected} disabled={selectedIds.length === 0} style={{ borderColor: selectedIds.length > 0 ? 'red' : '' }}>Apagar Selecionada(s)</button>
          
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, marginTop: '10px' }}>
            <input type="checkbox" checked={isSnapEnabled} onChange={e => setIsSnapEnabled(e.target.checked)} />
            Snap Inteligente (Ímã)
          </label>

          {selectedIds.length > 1 && (
            <div style={{ marginTop: '10px' }}>
              <p style={{ fontSize: 11, marginBottom: 5 }}>Alinhar:</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('left')}>Esquerda</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('centerH')}>Centro H.</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('right')}>Direita</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('top')}>Topo</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('centerV')}>Centro V.</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3 }} onClick={() => alignSelected('bottom')}>Base</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3, gridColumn: 'span 3' }} onClick={() => alignSelected('distH')}>Distribuir Horizontalmente</button>
                <button className="tool-btn" style={{ fontSize: 10, padding: 3, gridColumn: 'span 3' }} onClick={() => alignSelected('distV')}>Distribuir Verticalmente</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 5, marginTop: '15px' }}>
            <button className="tool-btn" style={{ flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} onClick={handleLoadPreset}>📂 Carregar</button>
            <button className="tool-btn" style={{ flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} onClick={handleSavePreset} disabled={shapes.length === 0}>💾 Salvar</button>
          </div>
        </div>

        <div className="tools-group" style={{ marginTop: 'auto' }}>
          <h3>Exportar</h3>
          <button className="tool-btn" onClick={autoSuggest} style={{ marginBottom: '10px' }}>Auto Sugerir (Grade 3x3)</button>
          
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
          <button onClick={handleCrop} style={{ backgroundColor: '#28a745', marginTop: '10px' }}>Recortar e Salvar</button>
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
                const isSelected = selectedIds.includes(shape.id);
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
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={2 / scale}
                      draggable={tool === 'select'}
                      onClick={(e) => handleShapeClick(r.id, e)}
                      onDragMove={(e) => handleDragMove(e, r.id)}
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
                            return { ...r, x: node.x(), y: node.y(), width: Math.max(5, r.width * scaleX), height: Math.max(5, r.height * scaleY) };
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
                      onClick={(e) => handleShapeClick(p.id, e)}
                      onDragMove={(e) => handleDragMove(e, p.id)}
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
                <Rect x={newRect.x} y={newRect.y} width={newRect.width} height={newRect.height} fill="rgba(0, 255, 0, 0.2)" stroke="green" strokeWidth={2 / scale} />
              )}
              {newPoly.length > 0 && (
                <Group>
                  <Line points={newPoly} stroke="cyan" strokeWidth={2 / scale} tension={tool === 'freehand' ? 0.5 : 0} closed={false} />
                  {tool === 'polygon' && newPoly.length >= 2 && <Circle x={newPoly[0]} y={newPoly[1]} radius={5 / scale} fill="yellow" stroke="black" strokeWidth={1/scale} />}
                </Group>
              )}

              {selectedIds.length > 0 && (
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
