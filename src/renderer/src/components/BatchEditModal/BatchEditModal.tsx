import { useState } from "react";
import type { TrackMetadataPatch } from "@shared/types";
import { TAXONOMY } from "@shared/soundTaxonomy";

interface BatchEditModalProps {
  count: number;
  onSubmit: (patch: TrackMetadataPatch) => void;
  onCancel: () => void;
}

const CATEGORY_OPTIONS = TAXONOMY.map((r) => r.category);
const SUBCATEGORY_OPTIONS = Array.from(
  new Set(TAXONOMY.flatMap((r) => r.subcategories.map((s) => s.name))),
);

function parseTagList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

export default function BatchEditModal({
  count,
  onSubmit,
  onCancel,
}: BatchEditModalProps): JSX.Element {
  const [applyCategory, setApplyCategory] = useState(false);
  const [category, setCategory] = useState("");
  const [applySubcategory, setApplySubcategory] = useState(false);
  const [subcategory, setSubcategory] = useState("");
  const [applyDescription, setApplyDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [addTagsInput, setAddTagsInput] = useState("");
  const [removeTagsInput, setRemoveTagsInput] = useState("");

  function submit(): void {
    const patch: TrackMetadataPatch = {};
    if (applyCategory) patch.category = category.trim() || null;
    if (applySubcategory) patch.subcategory = subcategory.trim() || null;
    if (applyDescription) patch.description = description.trim() || null;
    const addTags = parseTagList(addTagsInput);
    const removeTags = parseTagList(removeTagsInput);
    if (addTags.length > 0) patch.addTags = addTags;
    if (removeTags.length > 0) patch.removeTags = removeTags;
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSubmit(patch);
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal modal--wide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__title">Edit {count} sounds</div>

        <div className="batch-edit__row">
          <label className="batch-edit__check">
            <input
              type="checkbox"
              checked={applyCategory}
              onChange={(e) => setApplyCategory(e.target.checked)}
            />
            Set category
          </label>
          <input
            className="modal__input"
            list="batch-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={!applyCategory}
            placeholder="Category"
          />
        </div>

        <div className="batch-edit__row">
          <label className="batch-edit__check">
            <input
              type="checkbox"
              checked={applySubcategory}
              onChange={(e) => setApplySubcategory(e.target.checked)}
            />
            Set subcategory
          </label>
          <input
            className="modal__input"
            list="batch-subcategory-options"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            disabled={!applySubcategory}
            placeholder="Subcategory"
          />
        </div>

        <div className="batch-edit__row batch-edit__row--desc">
          <label className="batch-edit__check">
            <input
              type="checkbox"
              checked={applyDescription}
              onChange={(e) => setApplyDescription(e.target.checked)}
            />
            Set description
          </label>
          <textarea
            className="modal__input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!applyDescription}
            placeholder="Description"
          />
        </div>

        <div className="batch-edit__row">
          <span className="batch-edit__label">Add tags</span>
          <input
            className="modal__input"
            value={addTagsInput}
            onChange={(e) => setAddTagsInput(e.target.value)}
            placeholder="comma, separated, tags"
          />
        </div>
        <div className="batch-edit__row">
          <span className="batch-edit__label">Remove tags</span>
          <input
            className="modal__input"
            value={removeTagsInput}
            onChange={(e) => setRemoveTagsInput(e.target.value)}
            placeholder="comma, separated, tags"
          />
        </div>

        <datalist id="batch-category-options">
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="batch-subcategory-options">
          {SUBCATEGORY_OPTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="modal__actions">
          <button className="modal__btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal__btn modal__btn--primary" onClick={submit}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
