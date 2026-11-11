import type { ExploreGestureId } from "@/shared/lib/explore-gestures";

type GestureIllustrationProps = {
  id: ExploreGestureId;
};

/**
 * Simple stylized hand poses for the Explore guide — no photos, no debug meshes.
 */
export function GestureIllustration({ id }: GestureIllustrationProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      className="h-16 w-16 text-cyan-200/90"
      aria-hidden="true"
    >
      {id === "open_palm" ? <OpenPalm /> : null}
      {id === "closed_fist" ? <Fist /> : null}
      {id === "pinch" ? <Pinch /> : null}
      {id === "two_hand" ? <TwoHand /> : null}
      {id === "v_sign" ? <VSign /> : null}
    </svg>
  );
}

function PalmBase() {
  return (
    <path
      d="M34 78c-6-2-10-10-8-18l6-28c1-4 5-6 8-5 2 1 3 3 3 5v18l2-22c1-4 5-6 8-5s4 4 4 7v20l3-18c1-4 5-6 8-4s3 5 3 8v16l2-12c1-4 5-5 8-3s2 5 2 8v28c0 10-8 18-18 18H48c-6 0-12-3-14-10z"
      fill="currentColor"
      opacity="0.9"
    />
  );
}

function OpenPalm() {
  return (
    <g>
      <PalmBase />
      <path
        d="M40 22c0-6 4-12 8-12s7 5 7 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M52 18c0-7 4-12 8-12s7 5 7 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M64 24c0-6 3-10 7-10s6 4 6 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </g>
  );
}

function Fist() {
  return (
    <g>
      <ellipse cx="48" cy="54" rx="22" ry="20" fill="currentColor" opacity="0.9" />
      <path
        d="M30 48h36c2 0 4 2 4 4v4c0 10-8 18-18 18H44c-10 0-18-8-18-18v-4c0-2 2-4 4-4z"
        fill="currentColor"
      />
      <path
        d="M34 42h8v10h-8zM44 40h8v12h-8zM54 42h8v10h-8z"
        fill="currentColor"
        opacity="0.75"
      />
    </g>
  );
}

function Pinch() {
  return (
    <g>
      <path
        d="M40 78c-5-2-8-8-7-14l4-20c1-3 4-4 6-3s3 3 3 5v12l14-24c2-3 6-4 9-2s3 6 1 9L52 66c-2 4-6 10-12 12z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="62" cy="34" r="5" fill="currentColor" />
      <circle cx="70" cy="42" r="5" fill="currentColor" />
      <path
        d="M62 34c4 2 8 6 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.5"
      />
    </g>
  );
}

function TwoHand() {
  return (
    <g>
      <g transform="translate(-10 4) scale(0.72)">
        <Pinch />
      </g>
      <g transform="translate(28 4) scale(0.72)">
        <Pinch />
      </g>
    </g>
  );
}

function VSign() {
  return (
    <g>
      <path
        d="M36 80c-5-2-8-9-6-15l5-22c1-3 4-4 6-3s3 3 2 5v14l3-8c8-20 14-36 18-36 3 0 4 4 2 10L54 58l4-18c2-6 6-8 9-6s3 6 1 11L58 70c-3 8-10 12-22 10z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M48 48c6-16 12-30 16-30 3 0 4 5 2 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </g>
  );
}
