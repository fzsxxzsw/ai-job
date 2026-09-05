<script setup lang="ts">
import ViewRouter from "./components/ViewRouter.vue";
import Product from "./components/ui/Product.vue";
import {IS_PERSONAL_MODE} from "./deploymentMode";
</script>

<template>
    <ViewRouter/>
    <Product v-if="!IS_PERSONAL_MODE"/>
</template>

<style scoped>

</style>
