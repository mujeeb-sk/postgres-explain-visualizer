<script setup lang="ts">
import { faEdit, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { nextTick, useTemplateRef, watch } from 'vue';

import LogoImage from '@/components/LogoImage.vue';

import HistoryButtons from './HistoryButtons.vue';
import samples from './samples';
import { cancelEditing, deleteSaved, editSaved, openSaved, saveChanges, state, submit } from './state';
import ThemeButton from './ThemeButton.vue';

const version = __APP_VERSION__;

// When a saved plan's pencil is used, go to the top of the form, where it now is.
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');
watch(
  () => state.editing?.id,
  (id) => {
    if (id) {
      void nextTick(() => nameInput.value?.focus());
    }
  },
);

function loadSample(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const sample = samples[Number(select.value)];
  if (sample) {
    state.form = { name: sample[0], plan: sample[1], query: sample[2], comment: '' };
    state.invalid = false;
  }
  // Back to the "Sample Plans" label, so that the same sample can be chosen again.
  select.value = '';
}

/** "5 minutes ago"; a date once it is more than a month ago. */
function ago(created: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(created)) / 60_000);
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (!(minutes >= 1)) {
    return 'just now';
  }
  if (minutes < 60) {
    return count(minutes, 'minute');
  }
  if (minutes < 60 * 24) {
    return count(Math.floor(minutes / 60), 'hour');
  }
  if (minutes < 60 * 24 * 30) {
    return count(Math.floor(minutes / (60 * 24)), 'day');
  }
  return `on ${new Date(created).toLocaleDateString()}`;
}
</script>

<template>
  <div class="d-flex align-items-center border-bottom px-2 py-1">
    <HistoryButtons />
    <span class="ms-2">
      <LogoImage />
      <span class="fw-semibold">Postgres Explain Visualizer</span>
      <span class="small text-body-tertiary">{{ version }}</span>
    </span>
    <span class="ms-auto">
      <ThemeButton />
    </span>
  </div>
  <div class="home flex-grow-1 overflow-auto">
    <div class="container py-3">
      <div class="row">
        <div class="mb-4" :class="state.saved.length ? 'col-md-7' : 'col'">
          <p class="text-body-secondary">
            For best results, use
            <code>EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)</code>
            <br />
            <em>psql</em> users can export the plan to a file using
            <code class="text-nowrap">psql -XqAt -f explain.sql > analyze.json</code>
          </p>
          <form @submit.prevent="state.editing ? saveChanges() : submit()">
            <div v-if="state.editing" class="editing alert alert-info py-2">
              Editing the saved plan <strong>{{ state.editing.name }}</strong>. Change it here, then press Save Changes.
            </div>
            <div class="mb-3">
              <div class="d-flex align-items-center mb-2">
                <label for="planName" class="form-label mb-0">
                  Plan Name
                  <span class="small text-body-tertiary">(optional)</span>
                </label>
                <select
                  id="samplePlans"
                  class="form-select form-select-sm w-auto ms-auto"
                  aria-label="Sample Plans"
                  @change="loadSample"
                >
                  <option value="" selected>Sample Plans</option>
                  <option v-for="(sample, index) in samples" :key="index" :value="index">{{ sample[0] }}</option>
                </select>
              </div>
              <input
                id="planName"
                ref="nameInput"
                v-model="state.form.name"
                type="text"
                class="form-control"
                placeholder="Name for the plan"
              />
            </div>
            <div class="mb-3">
              <label for="planInput" class="form-label">
                Plan
                <span class="small text-body-tertiary">(text or JSON)</span>
              </label>
              <textarea
                id="planInput"
                v-model="state.form.plan"
                class="form-control pasted"
                :class="{ 'is-invalid': state.invalid }"
                rows="8"
                spellcheck="false"
                placeholder="Paste the output of EXPLAIN"
                @input="state.invalid = false"
              ></textarea>
              <div class="invalid-feedback">
                This isn't an EXPLAIN plan that can be shown. Paste all of EXPLAIN's output, in the text or JSON format.
              </div>
            </div>
            <div class="mb-3">
              <label for="queryInput" class="form-label">
                Query
                <span class="small text-body-tertiary">(optional)</span>
              </label>
              <textarea
                id="queryInput"
                v-model="state.form.query"
                class="form-control pasted"
                rows="8"
                spellcheck="false"
                placeholder="Paste the corresponding SQL query"
              ></textarea>
            </div>
            <div class="mb-3">
              <label for="commentInput" class="form-label">
                Comments
                <span class="small text-body-tertiary">(optional)</span>
              </label>
              <textarea
                id="commentInput"
                v-model="state.form.comment"
                class="form-control"
                rows="4"
                placeholder="Add notes about this plan"
              ></textarea>
            </div>
            <!-- The form is taller than most tabs: the button stays in sight at the bottom. -->
            <div class="sticky-bottom bg-body border-top py-2">
              <template v-if="state.editing">
                <button type="submit" class="save-changes btn btn-primary" :disabled="!state.form.plan.trim()">
                  Save Changes
                </button>
                <button type="button" class="cancel-editing btn btn-link" @click="cancelEditing">Cancel</button>
              </template>
              <button v-else type="submit" class="btn btn-primary" :disabled="!state.form.plan.trim()">Submit</button>
            </div>
          </form>
        </div>
        <!-- Only once the Save Plan button beside a plan has been used. -->
        <div v-if="state.saved.length" class="saved-plans col-md-5">
          <div class="mb-2">
            Saved Plans
            <span class="badge text-bg-secondary">{{ state.saved.length }}</span>
          </div>
          <p class="small text-body-tertiary">
            Kept on this computer, in VS Code's storage for this extension, until you delete them here.
          </p>
          <div class="list-group">
            <div
              v-for="plan in state.saved"
              :key="plan.id"
              class="saved-plan list-group-item list-group-item-action d-flex align-items-center p-0"
              :class="{ 'list-group-item-primary': state.editing?.id === plan.id }"
            >
              <button
                type="button"
                class="open-saved btn btn-link text-reset text-decoration-none text-start flex-grow-1 overflow-hidden px-2 py-1"
                @click="openSaved(plan.id)"
              >
                <span class="d-block text-truncate">{{ plan.name }}</span>
                <small class="text-body-tertiary" :title="new Date(plan.created).toLocaleString()">
                  saved {{ ago(plan.created) }}
                </small>
              </button>
              <button
                type="button"
                class="edit-saved btn btn-sm btn-outline-secondary py-0 me-1"
                title="Edit this saved plan: its name, plan, query and comments"
                @click="editSaved(plan.id)"
              >
                <FontAwesomeIcon :icon="faEdit" />
              </button>
              <button
                type="button"
                class="delete-saved btn btn-sm btn-outline-secondary py-0 me-2"
                title="Delete this saved plan"
                @click="deleteSaved(plan.id)"
              >
                <FontAwesomeIcon :icon="faTrash" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Plans and statements are lined up with spaces: keep them so, and scroll sideways. */
.pasted {
  font-family: var(--bs-font-monospace);
  font-size: 0.8rem;
  white-space: pre;
}
</style>
