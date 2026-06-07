'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export default function Home() {
  const router = useRouter();
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    // Create floating particles
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 6 + 's';
      particle.style.animationDuration = (4 + Math.random() * 4) + 's';
      const colors = ['#a855f7', '#3b82f6', '#06b6d4', '#ec4899'];
      particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      particle.style.width = (2 + Math.random() * 3) + 'px';
      particle.style.height = particle.style.width;
      hero.appendChild(particle);
    }
  }, []);

  return (
    <section className="hero" ref={heroRef}>
      <h1 className="hero-title">UPSIDE DOWN<br />GAMING CAFE</h1>
      <p className="hero-subtitle">Level Up Your Experience</p>
      <button
        onClick={() => router.push('/admin')}
        className="book-btn"
      >
        ADMIN DASHBOARD
      </button>
    </section>
  );
}
