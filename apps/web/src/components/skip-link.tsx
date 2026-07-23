'use client';

export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      onClick={(event) => {
        const target = document.getElementById('main-content');
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.scrollIntoView({ block: 'start' });
      }}
    >
      Skip to main content
    </a>
  );
}
