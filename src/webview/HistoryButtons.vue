<script setup lang="ts">
import { faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

import { canGoBack, canGoForward, goBack, goForward } from './state';
</script>

<template>
  <div class="history-buttons text-nowrap">
    <button type="button" class="go-back btn btn-link btn-sm py-0 px-1" title="Back" :disabled="!canGoBack" @click="goBack">
      <FontAwesomeIcon fixed-width :icon="faArrowLeft" />
    </button>
    <button
      type="button"
      class="go-forward btn btn-link btn-sm py-0 px-1"
      title="Forward"
      :disabled="!canGoForward"
      @click="goForward"
    >
      <FontAwesomeIcon fixed-width :icon="faArrowRight" />
    </button>
  </div>
</template>
