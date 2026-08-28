import type { JSX } from 'react';

/**
 * Progress of the speech model download.
 *
 * Determinate while Emscripten is reporting byte counts, indeterminate while it
 * is initialising and reporting nothing. Both states are shown differently on
 * purpose: a bar frozen at 43% for twenty seconds looks broken, whereas a bar
 * that is visibly still moving reads as work in progress.
 */
export function LoadProgress({ percent }: { percent: number | null }): JSX.Element {
  const determinate = percent !== null;

  return (
    <div className="loadbar" title={determinate ? `${percent}% downloaded` : 'Preparing the speech model'}>
      <div
        className={`loadbar__track${determinate ? '' : ' loadbar__track--indeterminate'}`}
        role="progressbar"
        aria-label="Speech model loading"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate ? { 'aria-valuenow': percent } : {})}
        aria-valuetext={determinate ? `${percent} percent downloaded` : 'Preparing, please wait'}
      >
        <div className="loadbar__fill" style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
      {determinate && <span className="loadbar__percent">{percent}%</span>}
    </div>
  );
}
