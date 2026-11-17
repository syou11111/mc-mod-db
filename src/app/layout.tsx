import type { Metadata } from 'next';
import './globals.css';
import { ClientRuntimeProvider } from '@/components/ClientRuntimeProvider';

export const metadata: Metadata = {
  title: 'MC MOD Database | マイクラMOD検索データベース',
  description:
    'Modrinth・CurseForge対応の個人向けMinecraft MOD検索・タグ管理データベース',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark">
      <body className="min-h-screen bg-[#0b0f17] text-slate-100 antialiased">
        <ClientRuntimeProvider>{children}</ClientRuntimeProvider>
      </body>
    </html>
  );
}
