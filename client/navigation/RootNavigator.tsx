import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStack } from './AuthStack';
import { AppTabs } from './AppTabs';
import { AttendanceVerificationScreen } from '../screens/attendance/AttendanceVerificationScreen';
import { AttendanceSuccessScreen } from '../screens/attendance/AttendanceSuccessScreen';
import { FaceRegistrationScreen } from '../screens/auth/FaceRegistrationScreen';
import { useUserStore, AttendanceRecord } from '../store';

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  AttendanceVerification: undefined;
  AttendanceSuccess: { record: AttendanceRecord };
  FaceRegistration: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const { isLoggedIn, user } = useUserStore();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isLoggedIn ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : !user?.faceRegistered ? (
          <Stack.Screen
            name="FaceRegistration"
            component={FaceRegistrationScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
        ) : (
          <>
            <Stack.Screen name="App" component={AppTabs} />
            <Stack.Screen
              name="AttendanceVerification"
              component={AttendanceVerificationScreen}
              options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="AttendanceSuccess"
              component={AttendanceSuccessScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="FaceRegistration"
              component={FaceRegistrationScreen}
              options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
