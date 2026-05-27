"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import type { EstimateType } from "@/generated/prisma/client";
import { updateCard, deleteCard, createDependency, deleteDependency, createCardInAdo } from "@/features/board/actions";
import { parseTags, TASK_TYPE_LABELS, ESTIMATE_TYPE_LABELS } from "@/features/board/types";
import { adoWorkItemEditUrl } from "@/features/ado/config";

export function EditCardModal({
  card,
  onClose,
  allCards,
  dependencies,
}: {
  card: CardModel;
  onClose: () => void;
  allCards: CardModel[];
  dependencies: DependencyModel[];
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const tags = parseTags(card.tags);
  const backendTag = tags.find((t) => t.name === "Backend");
  const frontendTag = tags.find((t) => t.name === "Frontend");

  const blockers = dependencies.filter((d) => d.blockedCardId === card.id);
  const blocking = dependencies.filter((d) => d.blockerCardId === card.id);
  const otherCards = allCards.filter((c) => c.id !== card.id);

  async function handleSubmit(formData: FormData) {
    await updateCard(formData);
    onClose();
  }

  async function handleDelete(formData: FormData) {
    await deleteCard(formData);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-ocean-2 border border-slate-300 dark:border-ocean-4 rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ocean-1 dark:text-white">Edit Task</h2>
          <button
            onClick={onClose}
            className="text-slate-400 dark:text-ocean-6 hover:text-slate-600 dark:hover:text-skyblue-1 text-lg"
          >
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={card.id} />
          <input type="hidden" name="gapSize" value={String(card.gapSize)} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 dark:text-skyblue-2">Title</span>
            <input
              name="title"
              type="text"
              required
              maxLength={200}
              defaultValue={card.title}
              className="border border-slate-300 dark:border-ocean-4 rounded px-3 py-1.5 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 dark:text-skyblue-2">Description</span>
            <textarea
              name="description"
              maxLength={2000}
              rows={2}
              defaultValue={card.description ?? ""}
              className="border border-slate-300 dark:border-ocean-4 rounded px-3 py-1.5 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5 resize-y"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 dark:text-skyblue-2">Task Type</span>
            <select
              name="taskType"
              defaultValue={card.taskType}
              className="border border-slate-300 dark:border-ocean-4 rounded px-3 py-1.5 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5"
            >
              {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-slate-600 dark:text-skyblue-2 mb-1">Estimate</legend>
            <EstimateFields card={card} />
          </fieldset>

          <div className="flex gap-6 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-ocean-1 dark:text-white">
              <input type="hidden" name="isGap" value="false" />
              <input
                type="checkbox"
                name="isGap"
                value="true"
                defaultChecked={card.isGap}
                className="accent-ocean-5"
              />
              Gap / Spacer
            </label>
            <label className="flex items-center gap-2 text-sm text-ocean-1 dark:text-white">
              <input type="hidden" name="backendApplicable" value="false" />
              <input
                type="checkbox"
                name="backendApplicable"
                value="true"
                defaultChecked={backendTag?.applicable ?? true}
                className="accent-ocean-5"
              />
              Backend
            </label>
            <label className="flex items-center gap-2 text-sm text-ocean-1 dark:text-white">
              <input type="hidden" name="frontendApplicable" value="false" />
              <input
                type="checkbox"
                name="frontendApplicable"
                value="true"
                defaultChecked={frontendTag?.applicable ?? true}
                className="accent-ocean-5"
              />
              Frontend
            </label>
            <label className="flex items-center gap-2 text-sm text-ocean-1 dark:text-white">
              <input type="hidden" name="codeReview" value="false" />
              <input
                type="checkbox"
                name="codeReview"
                value="true"
                defaultChecked={card.codeReview}
                className="accent-ocean-5"
              />
              Code Review (Apple/Google)
            </label>
          </div>

          <DependencySection
            card={card}
            blockers={blockers}
            blocking={blocking}
            otherCards={otherCards}
            allCards={allCards}
          />

          <fieldset className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-ocean-4">
            <legend className="text-xs font-medium text-slate-600 dark:text-skyblue-2 mb-1">Azure DevOps</legend>
            <AdoSection card={card} />
          </fieldset>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-ocean-4">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-500">Are you sure?</span>
                <button
                  type="button"
                  onClick={async () => {
                    const fd = new FormData();
                    fd.set("id", card.id);
                    await handleDelete(fd);
                  }}
                  className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs text-slate-500 dark:text-ocean-6 hover:text-ocean-1 dark:hover:text-skyblue-1"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
              >
                Delete task
              </button>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-ocean-6 hover:text-ocean-1 dark:hover:text-skyblue-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium rounded bg-ocean-5 text-white hover:bg-ocean-6 transition"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdoSection({ card }: { card: CardModel }) {
  const [sprint, setSprint] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (card.adoWorkItemId) {
    return (
      <div className="text-xs text-slate-600 dark:text-skyblue-2">
        ADO:{" "}
        <a
          href={adoWorkItemEditUrl(card.adoWorkItemId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ocean-5 dark:text-skyblue-1 hover:underline"
        >
          #{card.adoWorkItemId}
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        value={sprint}
        onChange={(e) => setSprint(e.target.value)}
        placeholder="Sprint #"
        className="w-24 border border-slate-300 dark:border-ocean-4 rounded px-2 py-1 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const n = sprint ? parseInt(sprint, 10) : null;
            const res = await createCardInAdo(card.id, Number.isNaN(n as number) ? null : n);
            if (!res.ok) setError(res.error);
            else router.refresh(); // server action's revalidatePath doesn't refresh this mounted client tree
          })
        }
        className="px-3 py-1.5 text-sm font-medium rounded bg-ocean-5 text-white hover:bg-ocean-6 transition disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create in ADO"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

function DependencySection({
  card,
  blockers,
  blocking,
  otherCards,
  allCards,
}: {
  card: CardModel;
  blockers: DependencyModel[];
  blocking: DependencyModel[];
  otherCards: CardModel[];
  allCards: CardModel[];
}) {
  const [addingBlocker, setAddingBlocker] = useState(false);

  const existingBlockerIds = new Set(blockers.map((d) => d.blockerCardId));
  const existingBlockingIds = new Set(blocking.map((d) => d.blockedCardId));
  const availableBlockers = otherCards.filter(
    (c) => !existingBlockerIds.has(c.id) && !existingBlockingIds.has(c.id),
  );

  function cardTitle(cardId: string) {
    return allCards.find((c) => c.id === cardId)?.title ?? "Unknown";
  }

  async function handleAddBlocker(blockerCardId: string) {
    await createDependency(blockerCardId, card.id);
    setAddingBlocker(false);
  }

  async function handleRemoveDep(depId: string) {
    await deleteDependency(depId);
  }

  return (
    <fieldset className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-ocean-4">
      <legend className="text-xs font-medium text-slate-600 dark:text-skyblue-2 mb-1">Dependencies</legend>

      {blockers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-ocean-6">Blocked by</span>
          {blockers.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between text-sm text-ocean-1 dark:text-white bg-rose-50 dark:bg-rose-500/10 rounded px-2 py-1">
              <span className="truncate">{cardTitle(dep.blockerCardId)}</span>
              <button
                type="button"
                onClick={() => handleRemoveDep(dep.id)}
                className="text-xs text-rose-500 hover:text-rose-700 ml-2 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-ocean-6">Blocking</span>
          {blocking.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between text-sm text-ocean-1 dark:text-white bg-amber-50 dark:bg-amber-500/10 rounded px-2 py-1">
              <span className="truncate">{cardTitle(dep.blockedCardId)}</span>
              <button
                type="button"
                onClick={() => handleRemoveDep(dep.id)}
                className="text-xs text-amber-600 hover:text-amber-800 ml-2 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {addingBlocker ? (
        <select
          autoFocus
          className="border border-slate-300 dark:border-ocean-4 rounded px-3 py-1.5 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5"
          onChange={(e) => {
            if (e.target.value) handleAddBlocker(e.target.value);
          }}
          onBlur={() => setAddingBlocker(false)}
          defaultValue=""
        >
          <option value="" disabled>Select a blocker...</option>
          {availableBlockers.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setAddingBlocker(true)}
          className="text-xs text-slate-500 dark:text-ocean-6 hover:text-ocean-5 dark:hover:text-skyblue-1 self-start"
        >
          + Add dependency
        </button>
      )}
    </fieldset>
  );
}

function EstimateFields({ card }: { card: CardModel }) {
  const [type, setType] = useState<EstimateType>(card.estimateType);
  const showDate = type === "HARD_DATE";
  const showWeeks = type === "WEEKS";
  const showLabel = showDate || showWeeks;

  const inputClasses = "border border-slate-300 dark:border-ocean-4 rounded px-3 py-1.5 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5";

  return (
    <>
      <select
        name="estimateType"
        value={type}
        onChange={(e) => setType(e.target.value as EstimateType)}
        className={inputClasses}
      >
        {Object.entries(ESTIMATE_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      {showDate && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-ocean-6">Date</span>
          <input
            name="estimateDate"
            type="date"
            defaultValue={card.estimateDate ? new Date(card.estimateDate).toISOString().split("T")[0] : ""}
            className={inputClasses}
          />
        </label>
      )}

      {showWeeks && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-ocean-6">Weeks</span>
          <input
            name="estimateWeeks"
            type="number"
            min={1}
            max={52}
            defaultValue={card.estimateWeeks ?? ""}
            className={inputClasses}
          />
        </label>
      )}

      {showLabel && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-ocean-6">Display label (e.g. &quot;21. mai&quot;, &quot;4 uker&quot;)</span>
          <input
            name="estimate"
            type="text"
            maxLength={40}
            defaultValue={card.estimate ?? ""}
            className={inputClasses}
          />
        </label>
      )}

      {!showLabel && <input type="hidden" name="estimate" value="" />}
      {!showDate && <input type="hidden" name="estimateDate" value="" />}
      {!showWeeks && <input type="hidden" name="estimateWeeks" value="" />}
    </>
  );
}
