<script setup lang="ts">
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

import Plan from '@/components/Plan.vue';

import HistoryButtons from './HistoryButtons.vue';
import Home from './Home.vue';
import { isSaved, newPlan, page, savePlan, state } from './state';
import ThemeButton from './ThemeButton.vue';
</script>

<template>
  <template v-if="state.loaded">
    <Plan
      v-if="page.plan"
      :key="state.at"
      :plan-source="page.plan.source"
      :plan-query="page.plan.query"
      :plan-comment="page.plan.comment || undefined"
    >
      <template #navigation>
        <HistoryButtons />
      </template>
      <template #toolbar>
        <button
          type="button"
          class="save-plan btn btn-outline-secondary btn-sm py-0 me-1"
          :disabled="isSaved"
          :title="isSaved ? 'This plan is under Saved Plans on the home page' : 'Keep this plan under Saved Plans on the home page'"
          @click="savePlan"
        >
          <template v-if="isSaved"><FontAwesomeIcon :icon="faCheck" /> Saved</template>
          <template v-else>Save Plan</template>
        </button>
        <button type="button" class="new-plan btn btn-secondary btn-sm py-0 me-1" @click="newPlan">New Plan</button>
        <ThemeButton />
      </template>
    </Plan>
    <Home v-else />
  </template>
</template>
