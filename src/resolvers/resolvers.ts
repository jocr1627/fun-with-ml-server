import {
  MutationResolvers,
  QueryResolvers,
  SubscriptionResolvers
} from 'fun-with-ml-schema';

export interface Resolvers {
  Mutation?: MutationResolvers.Resolvers;
  Query?: QueryResolvers.Resolvers;
  Subscription?: SubscriptionResolvers.Resolvers;
}
