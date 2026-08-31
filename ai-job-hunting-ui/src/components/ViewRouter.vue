<script setup lang="ts">
import {inject, onMounted, onUnmounted, shallowRef} from "vue";
import {Platform} from "../platform/platform.js";
import {AI_JOB_ROUTE_CHANGE_EVENT} from "../runtime/routeHost";

const platform = inject('$platform') as Platform;

const renderComponent = shallowRef(null)
let loadVersion = 0

const loadRenderComponent = async () => {
    const expectedVersion = ++loadVersion
    renderComponent.value = null
    const component = await platform.getRenderComponent()
    if (expectedVersion === loadVersion) renderComponent.value = component || null
}

onMounted(() => {
    void loadRenderComponent()
    window.addEventListener(AI_JOB_ROUTE_CHANGE_EVENT, loadRenderComponent)
})

onUnmounted(() => {
    window.removeEventListener(AI_JOB_ROUTE_CHANGE_EVENT, loadRenderComponent)
})

</script>

<template>
    <component :is="renderComponent"></component>
</template>

<style scoped>

</style>
