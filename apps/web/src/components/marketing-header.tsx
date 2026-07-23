'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

const links = [
  { href: '/#how-it-works', label: 'How it works', section: 'how-it-works' },
  { href: '/#career-radar', label: 'Career Radar', section: 'career-radar' },
  { href: '/#application-packs', label: 'Application Packs', section: 'application-packs' },
  { href: '/#roadmap', label: 'Roadmap', section: 'roadmap' },
  { href: '/#pricing', label: 'Pricing', section: 'pricing' },
  { href: '/#faq', label: 'FAQ', section: 'faq' },
] as const;

export function MarketingHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('how-it-works');

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/' || !('IntersectionObserver' in window)) return;
    const sections = links
      .flatMap((link) => ('section' in link ? [document.getElementById(link.section)] : []))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-18% 0px -64%', threshold: [0, 0.1, 0.35] },
    );
    sections.forEach((section) => {
      observer.observe(section);
    });
    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  return (
    <header className={`site-header ${scrolled || pathname !== '/' ? 'is-scrolled' : ''}`}>
      <div className="nav-shell">
        <Link aria-label="Hanaply home" className="brand" href="/">
          <Image
            alt=""
            aria-hidden="true"
            className="brand-logo-image brand-logo-on-dark"
            height={218}
            priority
            src="/brand/hanaply-logo.png"
            width={800}
          />
          <Image
            alt=""
            aria-hidden="true"
            className="brand-logo-image brand-logo-on-light"
            height={218}
            priority
            src="/brand/hanaply-logo-light.png"
            width={800}
          />
        </Link>
        <nav aria-label="Primary navigation" className="desktop-nav">
          {links.map((link) => {
            const active = pathname === '/' && activeSection === link.section;
            return (
              <Link
                className={active ? 'active' : ''}
                href={link.href}
                key={link.href}
                onClick={() => {
                  setActiveSection(link.section);
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-actions">
          <Link className="nav-plan-cta" href="/register">
            Create account
          </Link>
          <Link className="command-trigger" href="/login">
            Sign in
          </Link>
          <button
            aria-controls="mobile-menu"
            aria-expanded={menuOpen}
            className="menu-trigger"
            onClick={() => {
              setMenuOpen((value) => !value);
            }}
            type="button"
          >
            {menuOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav aria-label="Mobile navigation" className="mobile-nav" id="mobile-menu">
          {links.map((link) => (
            <Link
              href={link.href}
              key={link.href}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {link.label}
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            Sign in <span aria-hidden="true">↗</span>
          </Link>
          <Link
            href="/register"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            Create your account <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
