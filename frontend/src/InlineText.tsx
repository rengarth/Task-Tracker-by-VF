

export function Icon({ name }: { name: "edit" | "trash" }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {name === "edit" ? (
        <>
          <path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" />
        </>
      ) : (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
        </>
      )}
    </svg>
  );
}

