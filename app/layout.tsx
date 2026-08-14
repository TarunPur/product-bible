import type { Metadata } from "next";
import { Public_Sans, JetBrains_Mono, Oswald } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Playbook — every answer, cited",
  description:
    "Ask a question about product, growth, or leadership and get an attributed answer sourced directly from Lenny's Podcast episodes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${jetbrainsMono.variable} ${oswald.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div
          style={{ display: "contents" }}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `<!--
          THESIS: Chapter Index refuses the AI-chatbot search-bar rut -- the landing
          state IS a chapter list, not a decoration bolted onto a search box.
          OWN-WORLD: near-black broadcast-studio ground, one amber tally-light
          accent, condensed Oswald display type, tabular JetBrains Mono
          timestamps/index numerals, Public Sans body.
          STORY: visitor sees real question entries laid out like podcast show
          notes, each marked with the same bordered mono-pill numeral real
          citations use, previewing that visual grammar without inventing a
          guest or timestamp no answer has verified yet.
          FIRST VIEWPORT: dark hero, condensed headline top-left, an ask-form
          styled as a broadcast cue input, chapter-grouped question list below.
          FORM: Chapter Index -- candidate 3 of 7, seed key 49ac4baf.
          FINISH: unreviewed and undocumented is unfinished; this build ends
          with the finish review, the verdict, and DESIGN.md.
        -->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
