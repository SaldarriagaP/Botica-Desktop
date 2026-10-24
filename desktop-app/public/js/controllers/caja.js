import { api } from '../../api.js';
import { $, postJson, mensaje } from '../core/utils.js';

// Consulta el estado de la caja al servidor
export async function cargarCaja() {
  const estado = await api('/api/caja/estado');
  
  if (estado) {
    $('cajaEstado').textContent = `Caja abierta por ${estado.usuario} con S/ ${estado.monto_apertura}`;
  } else {
    $('cajaEstado').textContent = 'No hay caja abierta.';
  }
  
  // Mostrar u ocultar los formularios según corresponda
  $('cajaAbrirForm').style.display = estado ? 'none' : 'block';
  $('cajaCerrarForm').style.display = estado ? 'block' : 'none';
  
  return estado;
}

// Esta función se llamará desde app.js al iniciar
export function initCaja() {
  $('btnAbrirCaja').addEventListener('click', async () => {
    const res = await postJson('/api/caja/abrir', { monto: Number($('montoApertura').value || 0) });
    mensaje('cajaMsg', res, 'Caja abierta');
    if (res.ok) $('montoApertura').value = '';
    cargarCaja();
  });

  $('btnCerrarCaja').addEventListener('click', async () => {
    const res = await postJson('/api/caja/cerrar', { monto: Number($('montoCierre').value || 0) });
    mensaje('cajaMsg', res, 'Caja cerrada');
    if (res.ok) $('montoCierre').value = '';
    cargarCaja();
  });
}