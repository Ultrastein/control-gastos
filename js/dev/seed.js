import { toISO, todayISO, addMonths, daysInMonth, parseISO } from '../utils/dates.js';
import { addTransaction, listCategories, saveRecurring, saveBudget } from '../db.js';

// Mulberry32: determinístico PRNG simple.
function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Retorna int entre min (incl.) y max (excl.).
function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min)) + min;
}

export async function seedDemo() {
  const today = todayISO();
  const { y: todayY, m: todayM, d: todayD } = parseISO(today);
  const currentYm = today.slice(0, 7);

  const rng = mulberry32(42);
  const categories = await listCategories();
  const catMap = Object.fromEntries(categories.map(c => [c.name, c.id]));

  let count = 0;
  // Solo movimientos con fecha <= hoy (sin futuros en el mes actual).
  const addPast = async (tx) => { if (tx.date > today) return; await addTransaction(tx); count++; };

  // === Crear recurrentes ===
  const alquilerId = crypto.randomUUID();
  await saveRecurring({
    id: alquilerId,
    type: 'expense',
    amount: 50000000, // $500.000
    currency: 'ARS',
    categoryId: catMap['Alquiler'],
    dayOfMonth: 1,
    note: 'Alquiler',
    active: true,
    lastGeneratedMonth: currentYm, // el seed carga todos los meses a mano: nada pendiente para generateRecurring
  });

  const internetId = crypto.randomUUID();
  await saveRecurring({
    id: internetId,
    type: 'expense',
    amount: 3000000, // $30.000
    currency: 'ARS',
    categoryId: catMap['Servicios'],
    dayOfMonth: 15,
    note: 'Internet',
    active: true,
    lastGeneratedMonth: currentYm, // el seed carga todos los meses a mano: nada pendiente para generateRecurring
  });

  // === Generar 6 meses de movimientos ===
  const months = [];
  for (let i = 0; i < 6; i++) {
    months.push(addMonths(currentYm, -5 + i));
  }

  for (const ym of months) {
    const { y: mY, m: mM } = parseISO(ym + '-01');

    // Alquiler (recurring)
    await addPast({
      type: 'expense',
      amount: 50000000,
      currency: 'ARS',
      categoryId: catMap['Alquiler'],
      date: toISO(mY, mM, 1),
      note: 'Alquiler',
      recurringId: alquilerId,
      recurringMonth: ym,
    });

    // Internet (recurring)
    const intDay = Math.min(15, daysInMonth(mY, mM));
    await addPast({
      type: 'expense',
      amount: 3000000,
      currency: 'ARS',
      categoryId: catMap['Servicios'],
      date: toISO(mY, mM, intDay),
      note: 'Internet',
      recurringId: internetId,
      recurringMonth: ym,
    });

    // Ingreso mensual (sueldo)
    const sueldoDay = Math.min(3, daysInMonth(mY, mM));
    await addPast({
      type: 'income',
      amount: 150000000, // $1.500.000
      currency: 'ARS',
      categoryId: catMap['Otros'],
      date: toISO(mY, mM, sueldoDay),
      note: 'Sueldo',
    });

    // Ingreso extra en el 4° mes de la serie
    if (ym === months[3]) {
      await addPast({
        type: 'income',
        amount: 30000000, // $300.000
        currency: 'ARS',
        categoryId: catMap['Otros'],
        date: toISO(mY, mM, 10),
        note: 'Bonus',
      });
    }

    // Transporte/movilidad manual (variable por mes)
    const transAmount = 500000 + randInt(rng, 0, 500000); // $5.000-$10.000
    const transDay = randInt(rng, 3, 25);
    await addPast({
      type: 'expense',
      amount: transAmount,
      currency: 'ARS',
      categoryId: catMap['Transporte'],
      date: toISO(mY, mM, Math.min(transDay, daysInMonth(mY, mM))),
      note: 'Transporte',
    });

    // Salidas (categoría flexible que sube mes a mes)
    const salidasAmount = (15000000 + (months.indexOf(ym) * 3000000)); // Crece
    const salidasDay = randInt(rng, 5, 20);
    await addPast({
      type: 'expense',
      amount: salidasAmount,
      currency: 'ARS',
      categoryId: catMap['Salidas'],
      date: toISO(mY, mM, Math.min(salidasDay, daysInMonth(mY, mM))),
      note: 'Salidas',
    });

    // Compras chicas (da historial a la categoría para detectar el gasto inusual)
    await addPast({
      type: 'expense',
      amount: randInt(rng, 3000000, 6000000), // $30.000-$60.000
      currency: 'ARS',
      categoryId: catMap['Compras'],
      date: toISO(mY, mM, Math.min(randInt(rng, 2, 20), daysInMonth(mY, mM))),
      note: 'Compras',
    });

    // Comida: 1-2 gastos medianos
    const comidaCount = randInt(rng, 1, 3);
    for (let i = 0; i < comidaCount; i++) {
      const comidaAmount = randInt(rng, 3000000, 9000000);
      const comidaDay = randInt(rng, 1, 28);
      await addPast({
        type: 'expense',
        amount: comidaAmount,
        currency: 'ARS',
        categoryId: catMap['Comida'],
        date: toISO(mY, mM, Math.min(comidaDay, daysInMonth(mY, mM))),
        note: 'Comida',
      });
    }
  }

  // === Mes con ≥8 gastos pequeños (hormigas) en Comida (en mes actual) ===
  for (let i = 0; i < 8; i++) {
    const day = Math.min(2 + i * 2, todayD);
    await addPast({
      type: 'expense',
      amount: randInt(rng, 200000, 1000000), // $2.000-$10.000
      currency: 'ARS',
      categoryId: catMap['Comida'],
      date: toISO(todayY, todayM, day),
      note: 'Café',
    });
  }

  // === Gasto inusual grande (>2,5× mediana de su categoría, en mes actual) ===
  // Mediana de Compras estimada ~$50.000. Grande = >$125.000. Voy a crear $1.200.000.
  await addPast({
    type: 'expense',
    amount: 120000000, // $1.200.000 (electrónico, raro)
    currency: 'ARS',
    categoryId: catMap['Compras'],
    date: toISO(todayY, todayM, Math.min(18, todayD)),
    note: 'Laptop',
  });

  // === Duplicado exacto (mismo monto, categoría, días contigüos, en mes actual) ===
  const dupAmount = 7500000; // $75.000
  const dupDay1 = Math.min(10, todayD);
  const dupDay2 = Math.min(11, todayD);
  if (dupDay1 < dupDay2) {
    await addPast({
      type: 'expense',
      amount: dupAmount,
      currency: 'ARS',
      categoryId: catMap['Salidas'],
      date: toISO(todayY, todayM, dupDay1),
      note: 'Cena',
    });
    await addPast({
      type: 'expense',
      amount: dupAmount,
      currency: 'ARS',
      categoryId: catMap['Salidas'],
      date: toISO(todayY, todayM, dupDay2),
      note: 'Cena',
    });
  } else if (dupDay1 === todayD) {
    // Si solo cabe un día, agregar el mismo día (mejor que nada)
    await addPast({
      type: 'expense',
      amount: dupAmount,
      currency: 'ARS',
      categoryId: catMap['Salidas'],
      date: toISO(todayY, todayM, dupDay1),
      note: 'Cena',
    });
    await addPast({
      type: 'expense',
      amount: dupAmount,
      currency: 'ARS',
      categoryId: catMap['Salidas'],
      date: toISO(todayY, todayM, dupDay1),
      note: 'Cena',
    });
  }

  // === Presupuestos ===
  // Presupuesto bajo en Comida que se pasa (límite $500.000, pero tenemos >$500.000)
  await saveBudget({
    id: crypto.randomUUID(),
    categoryId: catMap['Comida'],
    monthlyLimit: 50000000, // $500.000
    currency: 'ARS',
  });

  // Presupuesto en Salidas
  await saveBudget({
    id: crypto.randomUUID(),
    categoryId: catMap['Salidas'],
    monthlyLimit: 100000000, // $1.000.000
    currency: 'ARS',
  });

  // Presupuesto en Transporte
  await saveBudget({
    id: crypto.randomUUID(),
    categoryId: catMap['Transporte'],
    monthlyLimit: 10000000, // $100.000
    currency: 'ARS',
  });

  return count;
}
