import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  concat,
} from '@apollo/client/core'
// @ts-expect-error #app resolved by Nuxt3
import { defineNuxtPlugin, NuxtApp } from '#app'
import { ApolloClients, provideApolloClient } from '@vue/apollo-composable'
import { setContext } from '@apollo/client/link/context';
import { parse, serialize } from "cookie-es";
import { ApolloModuleOptions } from './index'
import URI from 'urijs'
// @ts-expect-error #build resolved by Nuxt3
import apolloOptions from '#build/apollo.options.mjs' // generated by index.ts

const apolloModuleOptions: ApolloModuleOptions = apolloOptions;

const DEFAULT_CLIENT_ID = 'default'

export default defineNuxtPlugin((nuxt: NuxtApp) => {
  const apolloClients: {
    [key: string]: ApolloClient<any>
  } = {};
  const tokenNames: Record<string, string> = {};
  const clientConfigs = apolloModuleOptions.clientConfigs ? apolloModuleOptions.clientConfigs : apolloModuleOptions
  const defaultCookieAttributes = apolloModuleOptions.cookieAttributes

  function getTokenName(clientId: string) {
    return 'apollo_' + clientId + '_token'
  }
  function getToken(name: string, opts = {}) {
    if (process.server) {
      const cookies = parse(nuxt.ssrContext?.req.headers.cookie || "", opts) as Record<string, string>
      return cookies[name]
    } else if (process.client) {
      const cookies = parse(document.cookie, opts) as Record<string, string>
      return cookies[name]
    }
  }

  function getAuthLink(clientId: string, authenticationType = 'Bearer') {
    const authLink = setContext(async (_, { headers }) => {
      const token = getToken(getTokenName(clientId))
      const authorizationHeader = token ? { Authorization: authenticationType ? 'Bearer ' + token : token } : {}
      return {
        headers: {
          ...headers,
          ...authorizationHeader,
        },
      }
    })
    return authLink
  }

  function serializeCookie(name:string, value: string | null, opts = {}) {
    if (value == null) {
      return serialize(name, '', { ...opts, maxAge: -1 });
    }
    return serialize(name, value, opts);
  }
  function writeClientCookie(name:string, value: string | null, opts = {}) {
    if (process.client) {
      document.cookie = serializeCookie(name, value, opts);
    }
  }

  for (const clientId in clientConfigs) {
    const options = clientConfigs[clientId]
    const authLink = getAuthLink(clientId, options.authenticationType)

    const httpLink = createHttpLink(options)
    const cache = new InMemoryCache();
    if (process.server) {
      if (process.server) {
        if (new URI(options.uri).is('relative') && apolloModuleOptions.serverUri)
          options.uri = new URI(options.uri).absoluteTo(apolloModuleOptions.serverUri).toString()
      const apolloClient = new ApolloClient(Object.assign(options, {
        ssrMode: true,
        link: concat(authLink, httpLink),
        cache: new InMemoryCache()
      }))
      nuxt.hook("app:rendered", () => {
        // store the result
        nuxt.payload.data['apollo-' + clientId] = apolloClient.extract();
      });
      apolloClients[clientId] = apolloClient;
    } else {
      // restore to cache, so the client won't request
      cache.restore(JSON.parse(JSON.stringify(nuxt.payload.data['apollo-' + clientId])))
      const apolloClient = new ApolloClient(Object.assign(options, {
        link: concat(authLink, httpLink),
        cache: cache,
        ssrForceFetchDelay: 100,
      }))
      apolloClients[clientId] = apolloClient;
    }

  }

  const apolloHelpers = {
    onLogin: async (token: string, clientId: string, cookieAttributes: any, skipResetStore = false) => {
      clientId = clientId || DEFAULT_CLIENT_ID
      cookieAttributes = cookieAttributes || defaultCookieAttributes

      // Fallback for tokenExpires param
      if (typeof cookieAttributes === 'number') cookieAttributes = { expires: cookieAttributes }

      if (typeof cookieAttributes.expires === 'number') {
        cookieAttributes.expires = new Date(Date.now()+ 86400*1000*cookieAttributes.expires)
      }

      writeClientCookie(getTokenName(clientId), token, cookieAttributes)

      if (!skipResetStore) {
        try {
          await apolloClients[clientId].resetStore()
        } catch (e: any) {
          console.log('%cError on cache reset (setToken)', 'color: orange;', e.message)
        }
      }
    },
    onLogout: async (clientId = DEFAULT_CLIENT_ID, skipResetStore = false) => {
      writeClientCookie(getTokenName(clientId), null)

      if (!skipResetStore) {
        try {
          await apolloClients[clientId].resetStore()
        } catch (e: any) {
          console.log('%cError on cache reset (logout)', 'color: orange;', e.message)
        }
      }
    },
    getToken: (clientId = DEFAULT_CLIENT_ID) => {
      return getToken(getTokenName(clientId))
    }
  }

  // provide client, used in useQuery()
  nuxt.vueApp.provide(ApolloClients, apolloClients)
  // provide $apollo, used directly: $apollo.default
  nuxt.provide("apollo", apolloClients)
  nuxt.provide("apolloHelpers", apolloHelpers);
})
// @ts-expect-error #app resolved by Nuxt3
declare module '#app' {
  interface NuxtApp {
    $apollo: {
      [key: string]: ApolloClient<any>
    }
  }
}
