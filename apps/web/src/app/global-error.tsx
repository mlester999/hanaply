'use client';

export default function GlobalError() {
  return (
    <html lang="en-PH">
      <body>
        <main className="status-page">
          <h1>Hanaply could not start this page.</h1>
          <p>Reload the application after confirming its required services are available.</p>
        </main>
      </body>
    </html>
  );
}
