import { api } from '../../api.js';
import { $, h, soles, debounce, mensaje, limpiarMensaje, postJson } from '../core/utils.js';

let productosVenta = [];
let itemsVenta = [];

async function buscarProductosVenta() {
  const r = await api('/api/productos?' + new URLSearchParams({ q: $('ventaBuscar').value, soloActivos: '1', porPagina: 30 }));
  productosVenta = r.items;
  $('ventaProducto').innerHTML = productosVenta.map((p) =>
    `<option value="${p.id}">${h(p.name)} · ${soles(p.precio_unidad)} · stock ${h(p.stock_detalle.texto)}</option>`).join('');
}

function renderVenta() {
  document.querySelector('#ventaTabla tbody').innerHTML = itemsVenta.map((it, i) => `
    <tr><td>${h(it.nombre)}</td><td>${it.modo === 'fraccion' ? 'Unidad suelta' : 'Caja / unidad'}</td>
    <td class="num">${h(it.cantidad)}</td><td class="num">${soles(it.precio)}</td><td class="num">${soles(it.precio * it.cantidad)}</td>
    <td><button class="secundario" data-quitar="${i}">Quitar</button></td></tr>`).join('');
  $('ventaTotal').textContent = itemsVenta.reduce((acc, it) => acc + it.precio * it.cantidad, 0).toFixed(2);
}

export function initVentas() {
  $('ventaBuscar').addEventListener('input', debounce(buscarProductosVenta));

  $('btnAgregarItem').addEventListener('click', () => {
    const p = productosVenta.find((x) => x.id === Number($('ventaProducto').value));
    if (!p) return;
    const modo = $('ventaModo').value;
    if (modo === 'fraccion' && !p.se_fracciona) {
      return mensaje('ventaMsg', { ok: false, error: `"${p.name}" no se vende por unidad suelta` });
    }
    limpiarMensaje('ventaMsg');
    itemsVenta.push({
      productId: p.id, nombre: p.name, modo,
      cantidad: Number($('ventaCantidad').value || 1),
      precio: modo === 'fraccion' ? p.precio_fraccion : p.precio_unidad
    });
    renderVenta();
  });

  document.querySelector('#ventaTabla tbody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { itemsVenta.splice(Number(b.dataset.quitar), 1); renderVenta(); }
  });

  $('btnRegistrarVenta').addEventListener('click', async () => {
    const res = await postJson('/api/ventas', {
      items: itemsVenta.map(({ productId, cantidad, modo }) => ({ productId, cantidad, modo }))
    });
    mensaje('ventaMsg', res, res.ok ? `Venta registrada (${soles(res.total)})` : '');
    if (!res.ok) return;
    itemsVenta = [];
    renderVenta();
    buscarProductosVenta();
  });

  buscarProductosVenta();
}