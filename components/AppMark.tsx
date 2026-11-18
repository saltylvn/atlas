// The Atlas mark: three stacked emerald bars on near-black, like a board rolling
// up into one plan. Used for app icons (ImageResponse) and the sidebar.
export function AppMark({ size }: { size: number }) {
  const bar = (w: number, color: string) => (
    <div style={{ width: size * w, height: size * 0.11, borderRadius: size * 0.055, background: color }} />
  );
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: size * 0.07,
        paddingLeft: size * 0.22,
        background: "linear-gradient(135deg, #232323 0%, #171717 60%, #121212 100%)",
      }}
    >
      {bar(0.56, "#3ecf8e")}
      {bar(0.42, "#2b9b6a")}
      {bar(0.3, "#ededed")}
    </div>
  );
}
