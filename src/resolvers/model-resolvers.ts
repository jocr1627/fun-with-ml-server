import { GenerateJob, JobStatus, Model, TrainingJob } from 'fun-with-ml-schema';
import WebSocket from 'ws';
import { MessageKey, Status } from '../backend';
import { Event, pubsub } from '../pubsub';
import { Resolvers } from './resolvers';

const generateJobs: { [key: string]: GenerateJob } = {};
const models: { [key: string]: Model } = {};
const trainingJobs: { [key: string]: TrainingJob } = {};
let nextId = 0;

export const modelResolvers: Resolvers = {
  Mutation: {
    createModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { name } = args.input;
      const id = nextId.toString();
      const model = {
        id,
        name,
        urls: []
      };

      nextId += 1;
      models[id] = model;

      return model;
    },
    deleteModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id } = args.input;
      const model = models[id];

      if (!model) {
        return null;
      }

      return new Promise(resolve => {
        const socket = new WebSocket(
          process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
        );

        socket.onmessage = () => {
          socket.close();

          delete models[id];

          resolve();
        };

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              args: { model },
              key: MessageKey.Delete
            })
          );
        };
      });
    },
    generateTextFromModel: (_, args) => {
      if (!args || !models[args.input.id]) {
        return null;
      }

      const { count, id, maxLength, prefix, temperature } = args.input;
      const generateJob = { id, status: JobStatus.PENDING, text: [] };
      const model = models[id];
      const text: string[] = [];

      generateJobs[id] = generateJob;

      pubsub.publish(Event.TextGenerated, {
        textGenerated: generateJob
      });

      const socket = new WebSocket(
        process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
      );

      socket.onmessage = message => {
        const response = JSON.parse(message.data as string);
        let generateJob: GenerateJob;

        if (response.status == Status.Done) {
          socket.close();
          generateJob = { id, status: JobStatus.DONE, text };
        } else {
          text.push(response.results);
          generateJob = { id, status: JobStatus.ACTIVE, text };
        }

        generateJobs[id] = generateJob;

        pubsub.publish(Event.TextGenerated, {
          textGenerated: generateJob
        });
      };

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            args: { count, maxLength, model, prefix, temperature },
            key: MessageKey.Generate
          })
        );
      };

      return generateJob;
    },
    trainModel: (_, args) => {
      const hasUrl =
        args && models[args.input.id].urls.indexOf(args.input.url) >= 0;

      if (!args || !models[args.input.id] || (!args.input.force && hasUrl)) {
        return null;
      }

      const { epochs, id, selectors, url } = args.input;
      const model = models[id];
      const trainingJob = { id, status: JobStatus.PENDING };

      trainingJobs[id] = trainingJob;

      pubsub.publish(Event.BatchCompleted, {
        batchCompleted: trainingJob
      });

      if (!hasUrl) {
        const newModel = { ...model, urls: model.urls.concat(url) };

        models[id] = newModel;
      }

      const socket = new WebSocket(
        process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
      );

      socket.onmessage = message => {
        const response = JSON.parse(message.data as string);
        let trainingJob: TrainingJob;

        if (response.status == Status.Done) {
          socket.close();
          trainingJob = { id, status: JobStatus.DONE };
        } else {
          trainingJob = { ...response.results, id, status: JobStatus.ACTIVE };
        }

        trainingJobs[id] = trainingJob;

        pubsub.publish(Event.BatchCompleted, {
          batchCompleted: trainingJob
        });
      };

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            args: { epochs, model, selectors, url },
            key: MessageKey.Train
          })
        );
      };

      return trainingJob;
    },
    updateModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id, name } = args.input;
      const model = { ...models[id], name };

      models[id] = model;

      return model;
    }
  },
  Query: {
    generateJob: (_, args) => (args ? generateJobs[args.input.id] : null),
    model: (_, args) => (args ? models[args.input.id] : null),
    models: () => Object.keys(models).map(key => models[key]),
    trainingJob: (_, args) => (args ? trainingJobs[args.input.id] : null)
  },
  Subscription: {
    batchCompleted: {
      subscribe: () => pubsub.asyncIterator<TrainingJob>(Event.BatchCompleted)
    },
    textGenerated: {
      subscribe: () => pubsub.asyncIterator<GenerateJob>(Event.TextGenerated)
    }
  }
};
