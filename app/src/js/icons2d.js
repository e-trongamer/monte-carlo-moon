/* Flat side-view icons of the two spacecraft for 2D canvases
   (the chapter 3 step animations and the mini Monte Carlo). */

export function drawLanderIcon(c, x, y, s, flame = false) {
  c.save(); c.translate(x, y); c.scale(s, s);
  if (flame) {
    const g = c.createRadialGradient(0, 4, 0, 0, 4, 18);
    g.addColorStop(0, "rgba(255,240,200,.95)"); g.addColorStop(1, "rgba(255,190,110,0)");
    c.fillStyle = g; c.beginPath(); c.arc(0, 6, 18, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = "#d9d6cc"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-20, 0); c.lineTo(-12, -16); c.moveTo(20, 0); c.lineTo(12, -16); c.stroke();
  c.fillStyle = "#c8a24a"; c.fillRect(-14, -24, 28, 11);
  c.fillStyle = "#c9c6bd"; c.beginPath(); c.moveTo(-11, -24); c.lineTo(-8, -40); c.lineTo(8, -40); c.lineTo(11, -24); c.fill();
  c.restore();
}