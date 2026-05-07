import { useEffect, useRef } from "react";

/**
 * ============================
 * Particle Text Tunable Config
 * ============================
 * 你后续调节效果时，优先改这里。
 */

// 文字采样间距：数值越小，粒子越密；越大，粒子越稀。
const SAMPLE_GAP = 3;

// 粒子上限：防止窗口很大时粒子过多导致卡顿。
const MAX_PARTICLES = 8000;

// 粒子回到目标位置的吸引力：越大回归越快，越小越“软”。
const ATTRACTION = 0.01;

// 速度阻尼：越接近 1 越“飘”，越小越快停下。
const DAMPING = 0.8;

// 鼠标扰动半径与强度。
const MOUSE_RADIUS = 108;
const MOUSE_FORCE = 2;

// 粒子视觉参数（根据你的需求做成固定值，不再随机大小）。
const PARTICLE_RADIUS = 1.5;
const PARTICLE_COLOR = "#0f0f14";
const PARTICLE_OPACITY = 0.85;

// 辉光参数。
const GLOW_COLOR = "rgba(255, 255, 255, 0.6)";
const GLOW_BLUR = 12;

/**
 * 根据目标点生成粒子初始状态。
 * - 起点随机撒在画布内，形成“聚合”动效。
 * - 目标点 tx/ty 来自文字采样。
 */
function buildParticles(targets, width, height) {
  return targets.map((target) => ({
    // 当前坐标（会在动画中更新）
    x: Math.random() * width,
    y: Math.random() * height,

    // 目标坐标（文字轮廓上的采样点）
    tx: target.x,
    ty: target.y,

    // 当前速度
    vx: 0,
    vy: 0,

    // 固定半径：满足“不要随机大小”
    r: PARTICLE_RADIUS,
  }));
}

/**
 * 将文字转换为粒子目标点：
 * 1) 在离屏 Canvas 上画字
 * 2) 按网格采样 alpha
 * 3) alpha 达阈值的像素作为粒子目标
 */
function createParticleTargets(text, width, height) {
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.floor(width));
  offscreen.height = Math.max(1, Math.floor(height));

  const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
  if (!offCtx) return [];

  offCtx.clearRect(0, 0, width, height);
  offCtx.textBaseline = "alphabetic";

  // 根据容器尺寸估算字号，再做一次宽度校正，避免超出画布。
  let fontSize = Math.min(height * 0.85, (width / Math.max(text.length, 1)) * 1);
  fontSize = Math.max(fontSize, 20);
// 2. 换成重黑体（900字重），彻底解决扫描丢失细笔画的问题
  offCtx.font = `900 ${fontSize}px "SimSun", "Songti SC", sans-serif`;

  let metrics = offCtx.measureText(text);
  
  if (metrics.width > width * 0.9) {
    fontSize *= (width * 0.9) / metrics.width;
    offCtx.font = `700 ${fontSize}px "SimSun", "Songti SC", serif`;
    metrics = offCtx.measureText(text);
  }

  // 让文字在画布中央略偏下（更接近视觉中心）。
  const textX = (width - metrics.width) / 2;
  const textY = height / 2 + fontSize * 0.32;

  offCtx.fillStyle = "#ffffff";
  offCtx.fillText(text, textX, textY);

  const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;
  const targets = [];

  // 网格采样：命中 alpha 阈值的像素点加入目标集合。
  for (let y = 0; y < offscreen.height; y += SAMPLE_GAP) {
    for (let x = 0; x < offscreen.width; x += SAMPLE_GAP) {
      const alpha = imageData[(y * offscreen.width + x) * 4 + 3];
      if (alpha > 140) {
        targets.push({ x, y });
      }
    }
  }

  // 超上限时做步进抽样，控制性能上限。
  if (targets.length <= MAX_PARTICLES) return targets;

  const stride = Math.ceil(targets.length / MAX_PARTICLES);
  const compactTargets = [];
  for (let i = 0; i < targets.length; i += stride) {
    compactTargets.push(targets[i]);
  }
  return compactTargets;
}

export default function ParticleTextCanvas({ text = "壹珈智晟", className = "" }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animationRef = useRef(0);
  const resizeObserverRef = useRef(null);

  // 记录当前指针状态，用于“靠近时扰动”交互。
  const pointerRef = useRef({
    active: false,
    x: -9999,
    y: -9999,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    /**
     * 指针进入/移动时记录位置。
     * 注意：使用相对 canvas 的坐标，而不是页面绝对坐标。
     */
    const handlePointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.x = event.clientX - rect.left;
      pointerRef.current.y = event.clientY - rect.top;
      pointerRef.current.active = true;
    };

    // 指针离开后，关闭扰动影响。
    const clearPointer = () => {
      pointerRef.current.active = false;
      pointerRef.current.x = -9999;
      pointerRef.current.y = -9999;
    };

    /**
     * 容器尺寸变化时重建粒子：
     * - 重设 DPR，保证高清
     * - 重新采样文字目标点
     * - 重新生成粒子初始分布
     */
    const resetParticles = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const targets = createParticleTargets(text, width, height);
      particlesRef.current = buildParticles(targets, width, height);
    };

    /**
     * 每一帧更新 + 绘制。
     * 物理模型：
     * - 吸引力：粒子向目标点回归
     * - 阻尼：衰减速度，防止无限震荡
     * - 鼠标排斥：靠近指针的粒子被推开
     */
    const tick = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      ctx.clearRect(0, 0, width, height);

      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];

        // 回归目标点
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;

        // 鼠标扰动（在半径内产生排斥力）
        if (pointerRef.current.active) {
          const px = p.x - pointerRef.current.x;
          const py = p.y - pointerRef.current.y;
          const dist = Math.hypot(px, py);

          if (dist > 0.001 && dist < MOUSE_RADIUS) {
            const repel = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * MOUSE_FORCE;
            p.vx += (px / dist) * repel;
            p.vy += (py / dist) * repel;
          }
        }

        // 叠加回归力并施加阻尼
        p.vx = (p.vx + dx * ATTRACTION) * DAMPING;
        p.vy = (p.vy + dy * ATTRACTION) * DAMPING;

        // 位置更新
        p.x += p.vx;
        p.y += p.vy;
      }

      /**
       * 绘制阶段：
       * - 统一粒子颜色 #0f0f14
       * - 通过 shadowColor + shadowBlur 增加淡紫辉光
       */
      ctx.save();
      ctx.globalAlpha = PARTICLE_OPACITY;
      ctx.fillStyle = PARTICLE_COLOR;
      ctx.shadowColor = GLOW_COLOR;
      ctx.shadowBlur = GLOW_BLUR;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      animationRef.current = window.requestAnimationFrame(tick);
    };

    resetParticles();

    // 绑定指针事件
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerMove);
    canvas.addEventListener("pointerleave", clearPointer);
    canvas.addEventListener("pointercancel", clearPointer);

    // 监听容器尺寸变化
    resizeObserverRef.current = new ResizeObserver(resetParticles);
    resizeObserverRef.current.observe(canvas);

    // 启动动画循环
    animationRef.current = window.requestAnimationFrame(tick);

    // 清理：移除事件、停止动画、断开 observer
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerMove);
      canvas.removeEventListener("pointerleave", clearPointer);
      canvas.removeEventListener("pointercancel", clearPointer);

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text]);

  return <canvas ref={canvasRef} className={className} aria-label="particle text canvas" />;
}
