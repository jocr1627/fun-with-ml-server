import { modelResolvers } from './model-resolvers';
import { Resolvers } from './resolvers';

export const resolvers: Resolvers = {
  Mutation: {
    ...modelResolvers.Mutation
  },
  Query: {
    ...modelResolvers.Query
  },
  Subscription: {
    ...modelResolvers.Subscription
  }
};
