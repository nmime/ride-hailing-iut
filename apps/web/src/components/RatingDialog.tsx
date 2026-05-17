import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';

interface RatingDialogProps {
  tripId: string;
  onSubmit: (rating: number, comment?: string) => Promise<void>;
  onDismiss: () => void;
}

export function RatingDialog({ tripId, onSubmit, onDismiss }: RatingDialogProps) {
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    starRefs.current[rating - 1]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Focus once on open; arrow keys handle later focus moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDismiss]);

  function chooseRating(next: number, moveFocus = false) {
    const bounded = Math.min(5, Math.max(1, next));
    setRating(bounded);
    setHover(bounded);
    if (moveFocus) starRefs.current[bounded - 1]?.focus();
  }

  function handleStarKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, n: number) {
    const keyToRating: Record<string, number> = {
      ArrowRight: n === 5 ? 1 : n + 1,
      ArrowUp: n === 5 ? 1 : n + 1,
      ArrowLeft: n === 1 ? 5 : n - 1,
      ArrowDown: n === 1 ? 5 : n - 1,
      Home: 1,
      End: 5,
    };
    const next = keyToRating[event.key];
    if (!next) return;
    event.preventDefault();
    chooseRating(next, true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit(rating, comment.trim() || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rating-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <form className="modal-card stack" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Rate your driver</p>
          <h2 id="rating-title">How was trip {tripId.slice(0, 8)}?</h2>
        </div>
        <p id="rating-help" className="visually-hidden">
          Use arrow keys, Home, or End to choose a rating from 1 to 5 stars.
        </p>
        <div
          className="rating-stars"
          role="radiogroup"
          aria-labelledby="rating-title"
          aria-describedby="rating-help"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = n <= (hover || rating);
            return (
              <button
                key={n}
                ref={(node) => {
                  starRefs.current[n - 1] = node;
                }}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                tabIndex={rating === n ? 0 : -1}
                className={filled ? 'rating-star filled' : 'rating-star'}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                onKeyDown={(event) => handleStarKeyDown(event, n)}
                onClick={() => chooseRating(n)}
              >
                <span aria-hidden="true">★</span>
                <span className="visually-hidden">
                  {n} star{n === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
        <label htmlFor="rating-comment">
          Comment (optional)
          <textarea
            id="rating-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What stood out?"
            rows={3}
            maxLength={512}
          />
        </label>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        <div className="button-row">
          <button
            type="submit"
            className="btn primary"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit rating'}
          </button>
          <button type="button" className="btn ghost" onClick={onDismiss}>
            Maybe later
          </button>
        </div>
      </form>
    </div>
  );
}
