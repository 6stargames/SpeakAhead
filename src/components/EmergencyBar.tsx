import type { JSX } from 'react';
import { session } from '@/session/AacSession';
import { useStore, type AppState } from '@/state/store';

const selectEmergency = (state: AppState): boolean => state.emergencyOverride;

/**
 * Phrases that qualify for the red emergency surface: immediate physiological
 * threat only. Emotional distress and conversational repair go through the
 * ordinary boards - diluting this bar with them would teach onlookers that
 * red does not always mean an emergency.
 */
const EMERGENCY_PHRASES: readonly { label: string; text: string }[] = [
  { label: 'HELP', text: 'I need help right now.' },
  { label: 'PAIN', text: 'I am in severe pain.' },
  { label: "CAN'T BREATHE", text: 'I cannot breathe.' },
];

/**
 * RAUR User Need 11 - an AAC user must be able to communicate in an emergency.
 *
 * Lives at the foot of the navigation spine, pinned in every view: a control
 * you have to find is a control you do not have. The phrases speak on the
 * first press at full volume with incoming audio muted; the latch keeps that
 * override on so nothing can talk over the user afterwards. A latch, not a
 * hold-to-talk: someone in distress should not have to keep a finger down.
 */
export function EmergencyBar(): JSX.Element {
  const active = useStore(selectEmergency);

  return (
    <div className={`emergency${active ? ' emergency--active' : ''}`} data-scan="">
      {EMERGENCY_PHRASES.map((phrase) => (
        <button
          key={phrase.label}
          type="button"
          className="button button--danger emergency__phrase"
          title="Speaks immediately at full volume and mutes everything else."
          onClick={() => {
            // One press: override on, phrase out at full volume. No staging,
            // no confirmation - distress does not wait for a second tap.
            if (!active) session.setEmergencyOverride(true);
            void session.speak(phrase.text);
          }}
        >
          {phrase.label}
        </button>
      ))}

      <button
        type="button"
        className={`button ${active ? '' : 'button--danger'} emergency__latch`}
        aria-pressed={active}
        title={
          active
            ? 'Incoming audio is muted and your voice is at full volume. Press to turn off.'
            : 'Mutes everything coming in and puts your voice at full volume, so you cannot be talked over.'
        }
        onClick={() => session.setEmergencyOverride(!active)}
      >
        {active ? 'OVERRIDE ON' : 'OVERRIDE'}
      </button>

      {/* Assertive only while active: turning the override on must interrupt
          a concurrent screen reader immediately. */}
      {active && (
        <p className="visually-hidden" role="alert">
          Emergency override on. Incoming audio is muted and your voice is at full volume.
        </p>
      )}
    </div>
  );
}
