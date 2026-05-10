import { FormEvent, useEffect, useRef, useState } from 'react';

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
  const firstStarRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstStarRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

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
        <div className="rating-stars" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = n <= (hover || rating);
            return (
              <button
                key={n}
                ref={n === 1 ? firstStarRef : undefined}
                type="button"
                role="radio"
                aria-checked={rating === n}
                className={filled ? 'rating-star filled' : 'rating-star'}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                onClick={() => setRating(n)}
              >
                <span aria-hidden="true">★</span>
                <span className="visually-hidden">{n} star{n === 1 ? '' : 's'}</span>
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
        {err && <div className="error" role="alert">{err}</div>}
        <div className="button-row">
          <button type="submit" className="btn primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Submitting...' : 'Submit rating'}
          </button>
          <button type="button" className="btn ghost" onClick={onDismiss}>Maybe later</button>
        </div>
      </form>
    </div>
  );
}
