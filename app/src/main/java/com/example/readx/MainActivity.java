package com.example.readx;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import android.os.StrictMode;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.parse.LogInCallback;
import com.parse.Parse;
import com.parse.ParseAnalytics;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseUser;
import com.parse.SignUpCallback;

import org.apache.http.client.HttpClient;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.impl.client.DefaultHttpClient;

import java.net.HttpCookie;

public class MainActivity extends AppCompatActivity {


    Button login;
    EditText username;
    EditText password;
    Button signup;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        login = findViewById(R.id.login);
        username = findViewById(R.id.username);
        password = findViewById(R.id.password);
        signup = findViewById(R.id.signup);
//        ParseAnalytics.trackAppOpenedInBackground(getIntent());
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId(getString(R.string.back4app_app_id))
                .clientKey(getString(R.string.back4app_client_key))
                .server(getString(R.string.back4app_server_url))
                .build()
        );
        if (ParseUser.getCurrentUser() != null){
            Intent intent = new Intent(MainActivity.this,Groups.class);
            intent.putExtra("user",ParseUser.getCurrentUser().getUsername());
            startActivity(intent);
        }else{
            login.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    login(v);
                }
            });
            signup.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    signUp(v);
                }
            });
        }

    }

    public void signUp(View view){
        if(username.getText().toString().matches("") || password.getText().toString().matches("")){
            Toast.makeText(getApplicationContext(),"Username and Password are required!!", Toast.LENGTH_SHORT).show();
        }else{
            ParseUser user = new ParseUser();
            user.setUsername(username.getText().toString());
            user.setPassword(password.getText().toString());

            user.signUpInBackground(new SignUpCallback() {
                @Override
                public void done(ParseException e) {
                    if (e == null){
                        Log.i("Sign Up","Successful");
                        Intent intent = new Intent(MainActivity.this,Groups.class);
                        intent.putExtra("user",ParseUser.getCurrentUser().getUsername());
                        startActivity(intent);
                    }
                    else{
                        Log.i("SIgn Up","failed");
                        Toast.makeText(getApplicationContext(),e.getMessage(),Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    public void login(View view){
        ParseUser.logInInBackground(username.getText().toString(), password.getText().toString(), new LogInCallback() {
            @Override
            public void done(ParseUser user, ParseException e) {
                if (e == null){
                    Intent intent = new Intent(MainActivity.this,Groups.class);
                    intent.putExtra("user",ParseUser.getCurrentUser().getUsername());
                    startActivity(intent);
                }else{
                    Toast.makeText(getApplicationContext(),e.getMessage(),Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

}