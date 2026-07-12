import "./globals.css";

export const metadata = {
  title: "IC2 Reactor Planner",
  description: "Simulate and auto-design IC2 Classic nuclear reactors (Tekxit 3.14 mechanics)",
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/textures/uranium_quad_cell.png`,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
