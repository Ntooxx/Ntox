// WASM hot-path benchmarks for the JS vs WASM race demo.
// Each function is a no_mangle extern so JS can call it directly.

// ---------- 1. Prime sieve ----------
// Returns count of primes below n.
#[no_mangle]
pub extern "C" fn prime_count(n: u32) -> u32 {
    if n < 2 {
        return 0;
    }
    let limit = (n - 1) as usize;
    let mut flags = vec![true; limit + 1];
    let mut i = 2usize;
    while i * i <= limit {
        if flags[i] {
            let mut j = i * i;
            while j <= limit {
                flags[j] = false;
                j += i;
            }
        }
        i += 1;
    }
    let mut count = 0u32;
    for k in 2..=limit {
        if flags[k] {
            count += 1;
        }
    }
    count
}

// ---------- 2. Mandelbrot ----------
// Fills `out` (w*h bytes) with normalized iteration counts (0-255).
#[no_mangle]
pub unsafe extern "C" fn mandelbrot(
    out: *mut u8,
    w: u32,
    h: u32,
    max_iter: u32,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
) {
    let w = w as usize;
    let h = h as usize;
    for y in 0..h {
        let ci = y0 + (y1 - y0) * (y as f64) / (h - 1) as f64;
        for x in 0..w {
            let cr = x0 + (x1 - x0) * (x as f64) / (w - 1) as f64;
            let mut zr = 0.0f64;
            let mut zi = 0.0f64;
            let mut it = 0u32;
            while it < max_iter {
                let zr2 = zr * zr;
                let zi2 = zi * zi;
                if zr2 + zi2 > 4.0 {
                    break;
                }
                zi = 2.0 * zr * zi + ci;
                zr = zr2 - zi2 + cr;
                it += 1;
            }
            *out.add(y * w + x) = if it == max_iter {
                0
            } else {
                ((it * 255) / max_iter) as u8
            };
        }
    }
}

// ---------- 3. N-body physics ----------
// pos: [x0,y0,x1,y1,...]  vel: [vx0,vy0,...]  masses: [m0,...]
#[no_mangle]
pub unsafe extern "C" fn nbody_step(
    pos: *mut f32,
    vel: *mut f32,
    masses: *const f32,
    n: u32,
    dt: f32,
    soft: f32,
) {
    let n = n as usize;
    let g = 1.0f32;
    let soft2 = soft * soft;
    for i in 0..n {
        let mut ax = 0.0f32;
        let mut ay = 0.0f32;
        let xi = *pos.add(i * 2);
        let yi = *pos.add(i * 2 + 1);
        for j in 0..n {
            if i != j {
                let dx = *pos.add(j * 2) - xi;
                let dy = *pos.add(j * 2 + 1) - yi;
                let d2 = dx * dx + dy * dy + soft2;
                let inv = g * *masses.add(j) / (d2 * d2.sqrt());
                ax += dx * inv;
                ay += dy * inv;
            }
        }
        *vel.add(i * 2) += ax * dt;
        *vel.add(i * 2 + 1) += ay * dt;
    }
    for k in 0..n {
        *pos.add(k * 2) += *vel.add(k * 2) * dt;
        *pos.add(k * 2 + 1) += *vel.add(k * 2 + 1) * dt;
    }
}

// ---------- Memory allocator exports for JS interop ----------
// Layout: [u64 size header][payload], so JS can call free(ptr) with one arg.
use std::alloc::{alloc, dealloc, Layout};

const HEADER: usize = 16;

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let total = size + HEADER;
    match Layout::from_size_align(total, 16) {
        Ok(layout) => unsafe {
            let raw = alloc(layout);
            if raw.is_null() {
                return std::ptr::null_mut();
            }
            (raw as *mut usize).write(size);
            raw.add(HEADER)
        },
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn free(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    let raw = ptr.sub(HEADER);
    let size = (raw as *mut usize).read();
    if let Ok(layout) = Layout::from_size_align(size + HEADER, 16) {
        dealloc(raw, layout);
    }
}

// ---------- 4. Fibonacci (the one where JS often wins — honest demo) ----------
#[no_mangle]
pub extern "C" fn fib(n: u32) -> u64 {
    if n < 2 {
        return n as u64;
    }
    let mut a = 0u64;
    let mut b = 1u64;
    for _ in 2..=n {
        let c = a + b;
        a = b;
        b = c;
    }
    b
}