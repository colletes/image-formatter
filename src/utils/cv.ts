// Implementação de Visão Computacional para o Image Formatter

interface Point { x: number; y: number; }

function colorDiff(data: Uint8ClampedArray, i1: number, r2: number, g2: number, b2: number) {
  return Math.max(
    Math.abs(data[i1] - r2),
    Math.abs(data[i1 + 1] - g2),
    Math.abs(data[i1 + 2] - b2)
  );
}

// 1. Flood Fill
export function getMaskFromPoint(imageData: ImageData, x: number, y: number, tolerance: number): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  
  const startX = Math.floor(x);
  const startY = Math.floor(y);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return mask;

  const startIndex = (startY * width + startX) * 4;
  const targetR = data[startIndex];
  const targetG = data[startIndex + 1];
  const targetB = data[startIndex + 2];

  const stack = [{ x: startX, y: startY }];
  
  while (stack.length > 0) {
    const { x: cx, y: cy } = stack.pop()!;
    const idx = cy * width + cx;
    
    if (mask[idx]) continue;
    
    const dataIdx = idx * 4;
    const diff = colorDiff(data, dataIdx, targetR, targetG, targetB);
    
    if (diff <= tolerance) {
      mask[idx] = 1;
      if (cx > 0) stack.push({ x: cx - 1, y: cy });
      if (cx < width - 1) stack.push({ x: cx + 1, y: cy });
      if (cy > 0) stack.push({ x: cx, y: cy - 1 });
      if (cy < height - 1) stack.push({ x: cx, y: cy + 1 });
    }
  }

  return mask;
}

// 2. Moore Neighborhood Tracing
export function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  let startX = -1, startY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) return [];

  const dir = [
    { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
    { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    { x: -1, y: 1 }, { x: -1, y: 0 }
  ];

  const boundary: Point[] = [];
  let cx = startX, cy = startY;
  let moveDir = 7; 
  
  const maxIters = width * height; 
  let iters = 0;

  while (iters < maxIters) {
    boundary.push({ x: cx, y: cy });
    
    let found = false;
    let searchDir = (moveDir + 4 + 2) % 8;
    
    for (let i = 0; i < 8; i++) {
      const d = dir[searchDir];
      const nx = cx + d.x;
      const ny = cy + d.y;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (mask[ny * width + nx] === 1) {
          cx = nx;
          cy = ny;
          moveDir = searchDir;
          found = true;
          break;
        }
      }
      searchDir = (searchDir + 1) % 8;
    }

    if (!found || (cx === startX && cy === startY)) {
      break;
    }
    iters++;
  }

  return boundary;
}

// 3. Ramer-Douglas-Peucker
function perpendicularDistance(pt: Point, lineStart: Point, lineEnd: Point) {
  let dx = lineEnd.x - lineStart.x;
  let dy = lineEnd.y - lineStart.y;
  
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > 0) {
    dx /= mag;
    dy /= mag;
  }
  
  const pvx = pt.x - lineStart.x;
  const pvy = pt.y - lineStart.y;
  
  const pvdot = dx * pvx + dy * pvy;
  const dsx = pvdot * dx;
  const dsy = pvdot * dy;
  
  const ax = pvx - dsx;
  const ay = pvy - dsy;
  
  return Math.sqrt(ax * ax + ay * ay);
}

export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  
  if (dmax > epsilon) {
    const res1 = simplifyPoints(points.slice(0, index + 1), epsilon);
    const res2 = simplifyPoints(points.slice(index), epsilon);
    return res1.slice(0, -1).concat(res2);
  } else {
    return [points[0], points[end]];
  }
}

// Master function
export function getMagicWandPolygon(imageData: ImageData, x: number, y: number, tolerance: number, epsilon: number): number[] {
  const mask = getMaskFromPoint(imageData, x, y, tolerance);
  const boundary = traceBoundary(mask, imageData.width, imageData.height);
  const simplified = simplifyPoints(boundary, epsilon);
  
  const result: number[] = [];
  for (const pt of simplified) {
    result.push(pt.x, pt.y);
  }
  return result;
}
