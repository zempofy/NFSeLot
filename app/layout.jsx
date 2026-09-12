import "./globals.css";

export const metadata = {
  title: "iApura",
  description: "Download em lote de notas fiscais de serviço pela API Nacional",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
